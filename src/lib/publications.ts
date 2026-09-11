import { randomUUID } from "node:crypto";
import "server-only";
import { Platform, PubKind, PubStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { captionWithHashtags } from "@/lib/hashtags";
import type { OrgContext } from "@/lib/session";

/**
 * Lecture et écriture des Publications côté web.
 *
 * Deux invariants tenus ici:
 *  - le scope d'organisation, toujours issu de la session (9.6);
 *  - le verrou optimiste par `version` (7.4): une sauvegarde sur une version
 *    périmée est rejetée avec un message explicite, jamais appliquée en
 *    écrasant le travail d'un collègue.
 */

export class StaleVersionError extends Error {
  constructor() {
    super(
      "Someone else changed this publication in the meantime. Reload the page before saving again.",
    );
    this.name = "StaleVersionError";
  }
}

export async function listPublications(
  ctx: OrgContext,
  personaId?: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
) {
  return prisma.publication.findMany({
    where: {
      channelAccount: {
        persona: {
          organizationId: ctx.organizationId,
          ...(personaId ? { id: personaId } : {}),
        },
      },
      // Archivé veut dire « rangé », pas « supprimé »: les lignes restent, et
      // la vue les réclame explicitement quand l'opérateur veut les revoir.
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    select: {
      id: true,
      kind: true,
      name: true,
      copy: true,
      status: true,
      scheduledAt: true,
      publishedAt: true,
      remoteId: true,
      failureReason: true,
      version: true,
      groupId: true,
      starPrice: true,
      targetLabel: true,
      archivedAt: true,
      dryRun: true,
      createdBy: { select: { name: true } },
      channelAccount: {
        select: {
          id: true,
          platform: true,
          maxRating: true,
          persona: { select: { id: true, name: true, handle: true } },
        },
      },
      items: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          variant: {
            select: {
              id: true,
              ratio: true,
              r2Key: true,
              asset: { select: { rating: true } },
            },
          },
        },
      },
    },
    orderBy: [{ scheduledAt: "desc" }],
    take: 100,
  });
}

export type CreatePublicationInput = {
  /** Un canal, ou plusieurs: chacun donne sa propre Publication. */
  channelAccountIds: string[];
  kind: PubKind;
  name: string;
  caption: string;
  scheduledAt: Date;
  variantIds: string[];
  audioId?: string | null;
  audioVolume?: number | null;
  videoVolume?: number | null;
  /** Telegram: channel ou conversation de destination. */
  telegramChatId?: string | null;
  telegramTargetLabel?: string | null;
  /**
   * Telegram: prix en Stars. N'a de sens que sur un channel qui autorise le
   * paid media — TDLib refuse `inputMessagePaidMedia` ailleurs (4.2.6).
   */
  starPrice?: number | null;
  /** Fanvue: qui voit le post (4.3.7). */
  fanvueAudience?: "subscribers" | "followers-and-subscribers" | null;
  /** Fanvue: prix en cents USD, minimum 300, exige des médias. */
  fanvuePriceCents?: number | null;
  /** Fanvue: média affiché gratuitement avant déverrouillage. */
  fanvuePreviewVariantId?: string | null;
  /** Simulation: tout est vérifié, rien n'est envoyé. */
  dryRun?: boolean;
  /**
   * Hashtags choisis dans l'onglet Instagram. Concaténés à la légende de la
   * seule publication Instagram: l'API n'a pas de champ dédié, et Telegram n'a
   * rien à faire d'une traîne de croisillons (4.1.11).
   */
  hashtags?: string[];
};

/**
 * Crée une Publication **par canal** sélectionné.
 *
 * Règle d'or de la section 3: une publication qui échoue ne fait jamais tomber
 * ses sœurs. Un envoi multi-canal n'est donc pas un objet unique diffusé
 * partout, mais N publications indépendantes, chacune avec son propre état,
 * son propre workflow et son propre échec possible. Le `name` est ce qui les
 * relie pour l'œil de l'opérateur.
 *
 * **Cette indépendance vaut à l'exécution, pas à la création.** Ici, tout est
 * dans une seule transaction: si un canal refuse le média, rien n'est créé.
 *
 * La raison est qu'un refus à la création n'est pas un aléa de plateforme mais
 * une erreur de saisie, que le Composer empêche déjà en désactivant les médias
 * interdits. S'il en reste une, mieux vaut la renvoyer entière à l'opérateur
 * qu'écrire un sous-ensemble qu'il n'a pas demandé — d'autant que le résultat
 * dépendrait sinon de l'ordre de traitement des canaux, donc de rien.
 */
export async function createPublication(
  ctx: OrgContext,
  input: CreatePublicationInput,
): Promise<{ id: string; platform: Platform; channelAccountId: string }[]> {
  const channels = await prisma.channelAccount.findMany({
    where: {
      id: { in: input.channelAccountIds },
      persona: { organizationId: ctx.organizationId },
    },
    select: { id: true, platform: true },
  });

  if (channels.length !== input.channelAccountIds.length) {
    throw new Error("Channel not found in this organization.");
  }

  // Un identifiant pour tout le geste: les publications restent
  // indépendantes en base, mais l'écran les traite comme un seul envoi.
  const groupId = randomUUID();

  return prisma.$transaction(async (tx) => {
    const created: { id: string; platform: Platform; channelAccountId: string }[] = [];

    for (const channel of channels) {
      const row = await tx.publication.create({
        data: {
          groupId,
          channelAccountId: channel.id,
          createdByUserId: ctx.userId,
          kind: input.kind,
          name: input.name,
          copy:
            channel.platform === Platform.INSTAGRAM
              ? captionWithHashtags(input.caption, input.hashtags ?? [])
              : input.caption,
          scheduledAt: input.scheduledAt,
          status: PubStatus.SCHEDULED,
          audioId: input.audioId ?? null,
          audioVolume: input.audioVolume ?? null,
          videoVolume: input.videoVolume ?? null,
          // Telegram: destination et prix, ignorés par les autres canaux.
          // Le libellé est figé maintenant — un channel renommé ou quitté ne
          // doit pas rendre une publication passée illisible.
          targetChatId:
            channel.platform === Platform.TELEGRAM
              ? (input.telegramChatId ?? null)
              : null,
          targetLabel:
            channel.platform === Platform.TELEGRAM
              ? (input.telegramTargetLabel ?? null)
              : null,
          starPrice:
            channel.platform === Platform.TELEGRAM
              ? (input.starPrice ?? null)
              : null,
          // Fanvue: audience, prix en cents et teaser gratuit. Jamais
          // additionnés avec les Stars de Telegram — deux monnaies, deux
          // plateformes, et les confondre donnerait un post à 1 500 $.
          audience:
            channel.platform === Platform.FANVUE
              ? (input.fanvueAudience ?? "subscribers")
              : null,
          priceCents:
            channel.platform === Platform.FANVUE
              ? (input.fanvuePriceCents ?? null)
              : null,
          previewVariantId:
            channel.platform === Platform.FANVUE
              ? (input.fanvuePreviewVariantId ?? null)
              : null,
          dryRun: input.dryRun ?? false,
        },
        select: { id: true },
      });

      // Le trigger de rating s'exécute à l'insertion de chaque item: une
      // violation annule toute la transaction, tous canaux confondus.
      for (const [position, variantId] of input.variantIds.entries()) {
        await tx.publicationItem.create({
          data: { publicationId: row.id, variantId, position },
        });
      }

      created.push({
        id: row.id,
        platform: channel.platform,
        channelAccountId: channel.id,
      });
    }

    return created;
  });
}

/**
 * Réenregistrement d'une publication programmée, sous verrou optimiste.
 * `updateMany` avec la version attendue: zéro ligne touchée signifie que
 * quelqu'un est passé avant.
 */
export async function updateScheduledPublication(
  ctx: OrgContext,
  input: {
    publicationId: string;
    expectedVersion: number;
    caption: string;
    scheduledAt: Date;
  },
): Promise<{ version: number; platform: Platform }> {
  const publication = await prisma.publication.findFirst({
    where: {
      id: input.publicationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: { id: true, status: true, channelAccount: { select: { platform: true } } },
  });
  if (!publication) throw new Error("Publication not found in this organization.");

  const updated = await prisma.publication.updateMany({
    where: { id: input.publicationId, version: input.expectedVersion },
    data: {
      copy: input.caption,
      scheduledAt: input.scheduledAt,
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) throw new StaleVersionError();

  return {
    version: input.expectedVersion + 1,
    platform: publication.channelAccount.platform,
  };
}

/** Une publication MISSED que l'opérateur décide de sortir maintenant (7.6). */
export async function requeueMissedPublication(
  ctx: OrgContext,
  publicationId: string,
): Promise<{ platform: Platform }> {
  const publication = await prisma.publication.findFirst({
    where: {
      id: publicationId,
      status: PubStatus.MISSED,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: { id: true, channelAccount: { select: { platform: true } } },
  });
  if (!publication) throw new Error("Missed publication not found.");

  await prisma.publication.update({
    where: { id: publicationId },
    data: {
      status: PubStatus.SCHEDULED,
      scheduledAt: new Date(),
      version: { increment: 1 },
    },
  });

  return { platform: publication.channelAccount.platform };
}

export async function listPublishableVariants(ctx: OrgContext, personaId: string) {
  return prisma.variant.findMany({
    where: { asset: { personaId, persona: { organizationId: ctx.organizationId } } },
    select: {
      id: true,
      ratio: true,
      r2Key: true,
      localPath: true,
      cropOffset: true,
      asset: { select: { id: true, rating: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
