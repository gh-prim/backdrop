"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasTimezone } from "@/lib/schedule-time";
import { PubKind, PubStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { HASHTAG_LIMIT, totalHashtags } from "@/lib/hashtags";
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
  scheduleFanvuePublication,
  startFanvuePublishWorkflow,
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
  // Un instant, pas une heure murale: voir `schedule-time`.
  scheduledAt: z
    .string()
    .refine(hasTimezone, "The deadline must carry a timezone.")
    .transform((value) => new Date(value))
    .refine((date) => !Number.isNaN(date.getTime()), "Invalid deadline."),
  variantIds: z.array(z.string().min(1)).min(1, "At least one media."),
  telegramChatId: z.string().optional(),
  telegramTargetLabel: z.string().optional(),
  // Telegram plafonne le prix d'un message payant; la borne exacte vient de
  // `paid_media_message_star_count_max`, que le serveur annonce à 25000.
  starPrice: z.coerce.number().int().min(1).max(25000).optional(),
  // Fanvue: audience obligatoire côté API, prix plancher 300 cents (4.3.7).
  fanvueAudience: z.enum(["subscribers", "followers-and-subscribers"]).optional(),
  fanvuePriceCents: z.coerce.number().int().min(300).max(250000).optional(),
  fanvuePreviewVariantId: z.string().optional(),
  dryRun: z.coerce.boolean().optional(),
  // Instagram plafonne à 30 hashtags par publication.
  hashtags: z.array(z.string().min(1)).max(HASHTAG_LIMIT).optional(),
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
    scheduledAt: publishNow ? new Date().toISOString() : formData.get("scheduledAt"),
    variantIds: formData.getAll("variantIds").map(String),
    telegramChatId: String(formData.get("telegramChatId") ?? "").trim() || undefined,
    telegramTargetLabel:
      String(formData.get("telegramTargetLabel") ?? "").trim() || undefined,
    starPrice: String(formData.get("starPrice") ?? "").trim() || undefined,
    fanvueAudience: String(formData.get("fanvueAudience") ?? "").trim() || undefined,
    fanvuePriceCents:
      String(formData.get("fanvuePriceCents") ?? "").trim() || undefined,
    fanvuePreviewVariantId:
      String(formData.get("fanvuePreviewVariantId") ?? "").trim() || undefined,
    dryRun: formData.get("dryRun") === "1" || undefined,
    hashtags: formData.getAll("hashtags").map(String),
    audioId: String(formData.get("audioId") ?? "").trim() || undefined,
    audioVolume: String(formData.get("audioVolume") ?? "").trim() || undefined,
    videoVolume: String(formData.get("videoVolume") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Une publication Telegram sans destination échouerait au fond du worker,
  // sur un identifiant nul, très loin de sa cause. Le dire ici.
  const targetsTelegram = await channelsIncludeTelegram(
    ctx,
    parsed.data.channelAccountIds,
  );
  if (targetsTelegram && !parsed.data.telegramChatId) {
    return { ok: false, error: "Choose a Telegram destination before sending." };
  }

  // Règle maison: trois hashtags au plus. Bien en deçà du plafond d'Instagram,
  // qui refuserait la publication au-delà de trente (erreur 100/2207040). Le
  // total compte ceux tapés dans la légende **et** ceux choisis dans l'onglet.
  const total = totalHashtags(parsed.data.caption, parsed.data.hashtags ?? []);
  if (total > HASHTAG_LIMIT) {
    return {
      ok: false,
      error: `${total} hashtags between the caption and the Instagram tab: ${HASHTAG_LIMIT} at most.`,
    };
  }

  // Un teaser sans prix ne déverrouille rien, et un prix sans média n'est pas
  // achetable: les deux se disent ici, pas au fond du worker (4.3.7).
  if (parsed.data.fanvuePreviewVariantId && parsed.data.fanvuePriceCents === undefined) {
    return {
      ok: false,
      error: "A free preview only makes sense on a paid Fanvue post.",
    };
  }

  // Le teaser est montré à tous; les médias du post sont ce qu'on vend. Le
  // même fichier des deux côtés serait offert et vendu à la fois.
  if (
    parsed.data.fanvuePreviewVariantId &&
    parsed.data.variantIds.includes(parsed.data.fanvuePreviewVariantId)
  ) {
    return {
      ok: false,
      error: "The free preview cannot be one of the media the post sells.",
    };
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
      if (publication.platform === "FANVUE") {
        // Même queue que le worker Node, workflow distinct: l'upload part du
        // worker et il n'y a pas de container à surveiller (4.3.5).
        if (publishNow) await startFanvuePublishWorkflow(publication.id);
        else await scheduleFanvuePublication(publication.id, parsed.data.scheduledAt);
      } else if (publication.platform === "TELEGRAM") {
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
  // Un instant, pas une heure murale: voir `schedule-time`.
  scheduledAt: z
    .string()
    .refine(hasTimezone, "The deadline must carry a timezone.")
    .transform((value) => new Date(value))
    .refine((date) => !Number.isNaN(date.getTime()), "Invalid deadline."),
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

  const target = await prisma.publication.findFirst({
    where: {
      id: parsed.data.publicationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: { channelAccount: { select: { platform: true } } },
  });
  if (!target) return { ok: false, error: "Publication not found." };

  try {
    /**
     * Le Schedule est déplacé **avant** la base, et cet ordre est délibéré.
     *
     * Les deux ne sont pas dans la même transaction. Si la base changeait
     * d'abord et que le Schedule échouait, l'échéance annoncée à l'opérateur
     * et celle qui déclenche réellement divergeraient — une publication
     * partirait à l'ancienne heure alors que l'écran affiche la nouvelle, et
     * le message d'erreur laisserait croire que rien n'a bougé.
     *
     * Dans cet ordre, le pire cas est un Schedule déjà déplacé alors que la
     * base a refusé l'écriture. Il est inoffensif: le workflow relit toujours
     * la base au démarrage et attend l'heure qu'il y trouve.
     */
    const platform = target.channelAccount.platform;
    if (platform === "TELEGRAM") {
      await scheduleTelegramPublication(
        parsed.data.publicationId,
        parsed.data.scheduledAt,
      );
    } else {
      await schedulePublication(
        { id: parsed.data.publicationId, platform },
        parsed.data.scheduledAt,
      );
    }

    await updateScheduledPublication(ctx, parsed.data);

    // Le signal reste utile pour une publication déjà démarrée qui patiente
    // sur son timer, cas des publications créées avant les Schedules. Son
    // absence n'est pas une erreur: le Schedule porte déjà l'échéance.
    await rescheduleWorkflow(parsed.data.publicationId, parsed.data.scheduledAt).catch(
      () => {},
    );
  } catch (error) {
    if (error instanceof StaleVersionError) return { ok: false, error: error.message };
    return { ok: false, error: (error as Error).message };
  }

  revalidatePath("/publications");
  return { ok: true, message: "Publication saved." };
}

/**
 * Annule tout l'envoi, pas un de ses canaux.
 *
 * Une publication par canal est la bonne unité en base — un échec ne doit pas
 * en emporter d'autres — mais l'opérateur a composé **un** envoi et l'annule
 * en entier. Annuler Telegram en laissant partir Instagram serait une surprise.
 */
export async function cancelPublicationAction(publicationId: string): Promise<void> {
  const ctx = await requireOrgContext();

  for (const sibling of await siblings(ctx, publicationId)) {
    // L'ordre compte: retirer le Schedule d'abord, sinon il pourrait
    // redéclencher le workflow qu'on vient d'annuler.
    await unschedulePublication(sibling.id);
    await cancelPublishWorkflow(sibling.id);
  }

  revalidatePath("/publications");
  revalidatePath("/calendar");
}

/**
 * Les publications d'un même envoi, celle-ci comprise.
 *
 * Passe par le groupe et non par le nom: deux envois distincts peuvent porter
 * le même libellé, et les confondre annulerait le mauvais.
 */
async function siblings(
  ctx: { organizationId: string },
  publicationId: string,
): Promise<{ id: string; status: string }[]> {
  const publication = await prisma.publication.findFirst({
    where: {
      id: publicationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: { groupId: true },
  });
  if (!publication) return [];

  return prisma.publication.findMany({
    where: {
      groupId: publication.groupId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: { id: true, status: true },
  });
}

/** Sortir maintenant une publication passée en MISSED (7.6). */
export async function publishMissedNowAction(publicationId: string): Promise<void> {
  const ctx = await requireOrgContext();
  const { platform } = await requeueMissedPublication(ctx, publicationId);
  await unschedulePublication(publicationId);
  await cancelPublishWorkflow(publicationId);
  if (platform === "TELEGRAM") await startTelegramPublishWorkflow(publicationId);
  else await startPublishWorkflow({ id: publicationId, platform });
  revalidatePath("/publications");
}


/** Vrai si au moins un canal sélectionné est Telegram. */
async function channelsIncludeTelegram(
  ctx: { organizationId: string },
  channelAccountIds: string[],
): Promise<boolean> {
  if (channelAccountIds.length === 0) return false;
  const count = await prisma.channelAccount.count({
    where: {
      id: { in: channelAccountIds },
      platform: "TELEGRAM",
      persona: { organizationId: ctx.organizationId },
    },
  });
  return count > 0;
}


/** États terminaux: seuls eux peuvent être rangés (voir schéma). */
const ARCHIVABLE: PubStatus[] = [
  PubStatus.PUBLISHED,
  PubStatus.DRY_RUN,
  PubStatus.FAILED,
  PubStatus.MISSED,
];

/**
 * Range une publication hors de la vue courante, sans la supprimer.
 *
 * Refusé sur une publication encore à venir: la masquer donnerait le sentiment
 * de l'avoir annulée, alors qu'elle partirait quand même. Pour celles-là,
 * l'action juste est « Cancel ».
 */
export async function archivePublicationAction(
  publicationId: string,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  const publication = await prisma.publication.findFirst({
    // Scope serveur: l'organisation vient de la session (9.6).
    where: {
      id: publicationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: { id: true, status: true },
  });
  if (!publication) return { ok: false, error: "Publication not found." };

  if (!ARCHIVABLE.includes(publication.status)) {
    return {
      ok: false,
      error: "Only a finished publication can be archived. Cancel it first.",
    };
  }

  // Tout l'envoi est rangé d'un coup: laisser un canal seul dans la liste
  // donnerait l'illusion d'une publication mono-canal qui n'a jamais existé.
  await prisma.publication.updateMany({
    where: {
      groupId: (
        await prisma.publication.findUniqueOrThrow({
          where: { id: publication.id },
          select: { groupId: true },
        })
      ).groupId,
      status: { in: ARCHIVABLE },
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    data: { archivedAt: new Date() },
  });

  revalidatePath("/publications");
  revalidatePath("/calendar");
  return { ok: true, message: "Archived." };
}

export async function unarchivePublicationAction(
  publicationId: string,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  const group = await prisma.publication.findFirst({
    where: {
      id: publicationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: { groupId: true },
  });
  if (!group) return { ok: false, error: "Publication not found." };

  const updated = await prisma.publication.updateMany({
    where: {
      groupId: group.groupId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    data: { archivedAt: null },
  });
  if (updated.count === 0) return { ok: false, error: "Publication not found." };

  revalidatePath("/publications");
  revalidatePath("/calendar");
  return { ok: true, message: "Back in the list." };
}
