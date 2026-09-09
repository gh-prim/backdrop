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
  startPublishWorkflow,
} from "@/temporal/client";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const createSchema = z.object({
  channelAccountIds: z.array(z.string().min(1)).min(1, "Au moins un canal."),
  kind: z.enum(PubKind),
  name: z.string().min(1, "Nom requis.").max(120),
  caption: z.string().max(2200, "2200 caractères maximum sur Instagram."),
  scheduledAt: z.coerce.date(),
  variantIds: z.array(z.string().min(1)).min(1, "Au moins un média."),
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
    audioId: String(formData.get("audioId") ?? "").trim() || undefined,
    audioVolume: String(formData.get("audioVolume") ?? "").trim() || undefined,
    videoVolume: String(formData.get("videoVolume") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  if (parsed.data.kind !== "CAROUSEL" && parsed.data.variantIds.length > 1) {
    return { ok: false, error: "Un post simple ou un Reel ne porte qu'un média." };
  }
  if (parsed.data.kind === "CAROUSEL" && parsed.data.variantIds.length > 10) {
    return { ok: false, error: "Un carrousel accepte 10 éléments au maximum." };
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
          "Rejeté par la base: au moins un média dépasse le rating maximal autorisé sur ce canal.",
      };
    }
    return { ok: false, error: message || "Création impossible." };
  }

  // Un workflow par publication: démarrage à la programmation, pas à
  // l'échéance (7.6). L'échec d'un démarrage ne doit pas masquer les autres.
  const notStarted: string[] = [];
  for (const publication of created) {
    try {
      await startPublishWorkflow(publication);
    } catch (error) {
      notStarted.push(`${publication.platform}: ${(error as Error).message}`);
    }
  }

  revalidatePath("/publications");
  revalidatePath("/");

  if (notStarted.length > 0) {
    return {
      ok: false,
      error: `Publications enregistrées, mais des workflows n'ont pas démarré — ${notStarted.join(" ; ")}`,
    };
  }

  const count = created.length;
  const suffix = count > 1 ? `s (${count} canaux)` : "";
  return {
    ok: true,
    message: publishNow
      ? `Publication${suffix} lancée${count > 1 ? "s" : ""}, elle part maintenant.`
      : `Publication${suffix} programmée${count > 1 ? "s" : ""}.`,
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
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  try {
    await updateScheduledPublication(ctx, parsed.data);
    // Le workflow dort déjà: on lui signale la nouvelle heure plutôt que de
    // l'annuler et d'en redémarrer un (7.6).
    await rescheduleWorkflow(parsed.data.publicationId, parsed.data.scheduledAt);
  } catch (error) {
    if (error instanceof StaleVersionError) return { ok: false, error: error.message };
    return { ok: false, error: (error as Error).message };
  }

  revalidatePath("/publications");
  return { ok: true, message: "Publication réenregistrée." };
}

export async function cancelPublicationAction(publicationId: string): Promise<void> {
  await requireOrgContext();
  await cancelPublishWorkflow(publicationId);
  revalidatePath("/publications");
}

/** Sortir maintenant une publication passée en MISSED (7.6). */
export async function publishMissedNowAction(publicationId: string): Promise<void> {
  const ctx = await requireOrgContext();
  const { platform } = await requeueMissedPublication(ctx, publicationId);
  await cancelPublishWorkflow(publicationId);
  await startPublishWorkflow({ id: publicationId, platform });
  revalidatePath("/publications");
}
