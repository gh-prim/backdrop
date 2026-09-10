"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PubKind } from "@prisma/client";
import { requireOrgContext } from "@/lib/session";
import {
  StaleVersionError,
  createPublication,
  requeueMissedPublication,
  updateScheduledPublication,
} from "@/lib/publications";
import {
  cancelPublishWorkflow,
  rescheduleWorkflow,
  schedulePublication,
  scheduleTelegramPublication,
  startPublishWorkflow,
  startTelegramPublishWorkflow,
  unschedulePublication,
} from "@/temporal/client";

export type ActionResult =
  | { ok: true; message?: string; publicationIds?: string[] }
  | { ok: false; error: string };

const createSchema = z.object({
  channelAccountIds: z.array(z.string().min(1)).min(1, "At least one channel."),
  kind: z.enum(PubKind),
  name: z.string().min(1, "Name required.").max(120),
  caption: z.string().max(2200, "2200 characters maximum on Instagram."),
  scheduledAt: z.coerce.date(),
  variantIds: z.array(z.string().min(1)).min(1, "At least one media."),
  telegramChatId: z.string().optional(),
  telegramTargetLabel: z.string().optional(),
  // Telegram plafonne le prix d'un message payant; la borne exacte vient de
  // `paid_media_message_star_count_max`, que le serveur annonce à 25000.
  starPrice: z.coerce.number().int().min(1).max(25000).optional(),
  audioId: z.string().optional(),
  audioVolume: z.coerce.number().int().min(0).max(100).optional(),
  videoVolume: z.coerce.number().int().min(0).max(100).optional(),
});

export async function schedulePublicationAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  // « Publier tout de suite » n'est pas un chemin d'exécution parallèle: c'est
  // une programmation à l'instant présent. Le workflow, la tolérance de retard
  // et l'idempotence restent exactement les mêmes (7.6).
  const publishNow = formData.get("publishNow") === "1";

  const parsed = createSchema.safeParse({
    channelAccountIds: formData.getAll("channelAccountIds").map(String),
    kind: formData.get("kind"),
    name: String(formData.get("name") ?? "").trim(),
    caption: String(formData.get("caption") ?? ""),
    scheduledAt: publishNow ? new Date() : formData.get("scheduledAt"),
    variantIds: formData.getAll("variantIds").map(String),
    telegramChatId: String(formData.get("telegramChatId") ?? "").trim() || undefined,
    telegramTargetLabel:
      String(formData.get("telegramTargetLabel") ?? "").trim() || undefined,
    starPrice: String(formData.get("starPrice") ?? "").trim() || undefined,
    audioId: String(formData.get("audioId") ?? "").trim() || undefined,
    audioVolume: String(formData.get("audioVolume") ?? "").trim() || undefined,
    videoVolume: String(formData.get("videoVolume") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  if (parsed.data.kind !== "CAROUSEL" && parsed.data.variantIds.length > 1) {
    return { ok: false, error: "A single post or a Reel carries one media only." };
  }
  if (parsed.data.kind === "CAROUSEL" && parsed.data.variantIds.length > 10) {
    return { ok: false, error: "A carousel takes 10 items at most." };
  }

  let created: { id: string; platform: "INSTAGRAM" | "TELEGRAM" | "FANVUE" }[];
  try {
    created = await createPublication(ctx, parsed.data);
  } catch (error) {
    // Le rejet par le trigger de rating remonte ici: c'est la base qui a
    // tranché, pas l'application (spec 8 et 9.1).
    const message = (error as Error).message ?? "";
    if (message.includes("rating_violation")) {
      return {
        ok: false,
        error:
          "Rejected by the database: at least one media exceeds the maximum rating allowed on this channel.",
      };
    }
    return { ok: false, error: message || "Could not create." };
  }

  /**
   * Deux chemins distincts (7.6):
   *  - **envoi immédiat**: on démarre le workflow tout de suite, et
   *    `workflowId = publish:{id}` interdit le doublon;
   *  - **programmation**: un Temporal Schedule à déclenchement unique porte
   *    l'échéance, ce qui la rend visible et modifiable dans la console.
   *
   * L'échec d'un démarrage ne doit pas masquer celui des autres canaux.
   */
  const notStarted: string[] = [];
  for (const publication of created) {
    try {
      if (publication.platform === "TELEGRAM") {
        // Telegram a sa propre task queue et son propre workflow: le worker
        // Python est le seul à parler TDLib (7.3).
        if (publishNow) await startTelegramPublishWorkflow(publication.id);
        else await scheduleTelegramPublication(publication.id, parsed.data.scheduledAt);
      } else if (publishNow) {
        await startPublishWorkflow(publication);
      } else {
        await schedulePublication(publication, parsed.data.scheduledAt);
      }
    } catch (error) {
      notStarted.push(`${publication.platform}: ${(error as Error).message}`);
    }
  }

  revalidatePath("/publications");
  revalidatePath("/");

  if (notStarted.length > 0) {
    return {
      ok: false,
      error: `Publications saved, but some workflows did not start — ${notStarted.join(" ; ")}`,
    };
  }

  const count = created.length;
  const suffix = count > 1 ? `s (${count} channels)` : "";
  return {
    ok: true,
    publicationIds: created.map((publication) => publication.id),
    message: publishNow
      ? `Publication${suffix} sent, going out now.`
      : `Publication${suffix} scheduled.`,
  };
}

const updateSchema = z.object({
  publicationId: z.string().min(1),
  expectedVersion: z.coerce.number().int().min(0),
  caption: z.string().max(2200),
  scheduledAt: z.coerce.date(),
});

/** Réenregistrement sous verrou optimiste (7.4). */
export async function reschedulePublicationAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();
  const parsed = updateSchema.safeParse({
    publicationId: formData.get("publicationId"),
    expectedVersion: formData.get("expectedVersion"),
    caption: String(formData.get("caption") ?? ""),
    scheduledAt: formData.get("scheduledAt"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const { platform } = await updateScheduledPublication(ctx, parsed.data);
    // La nouvelle échéance est portée par le Schedule. Le signal reste utile
    // pour une publication déjà démarrée qui patiente sur son timer, cas des
    // publications créées avant le passage aux Schedules.
    await schedulePublication(
      { id: parsed.data.publicationId, platform },
      parsed.data.scheduledAt,
    );
    await rescheduleWorkflow(parsed.data.publicationId, parsed.data.scheduledAt);
  } catch (error) {
    if (error instanceof StaleVersionError) return { ok: false, error: error.message };
    return { ok: false, error: (error as Error).message };
  }

  revalidatePath("/publications");
  return { ok: true, message: "Publication saved." };
}

export async function cancelPublicationAction(publicationId: string): Promise<void> {
  await requireOrgContext();
  // L'ordre compte: retirer le Schedule d'abord, sinon il pourrait redéclencher
  // le workflow qu'on vient d'annuler.
  await unschedulePublication(publicationId);
  await cancelPublishWorkflow(publicationId);
  revalidatePath("/publications");
}

/** Sortir maintenant une publication passée en MISSED (7.6). */
export async function publishMissedNowAction(publicationId: string): Promise<void> {
  const ctx = await requireOrgContext();
  const { platform } = await requeueMissedPublication(ctx, publicationId);
  await unschedulePublication(publicationId);
  await cancelPublishWorkflow(publicationId);
  await startPublishWorkflow({ id: publicationId, platform });
  revalidatePath("/publications");
}
