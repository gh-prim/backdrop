import "server-only";
import { Platform, PubKind, PubStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
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
      "Cette publication a été modifiée par quelqu'un d'autre entre-temps. Rechargez la page avant de réenregistrer.",
    );
    this.name = "StaleVersionError";
  }
}

export async function listPublications(ctx: OrgContext, personaId?: string) {
  return prisma.publication.findMany({
    where: {
      channelAccount: {
        persona: {
          organizationId: ctx.organizationId,
          ...(personaId ? { id: personaId } : {}),
        },
      },
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
    throw new Error("Canal introuvable dans cette organisation.");
  }

  return prisma.$transaction(async (tx) => {
    const created: { id: string; platform: Platform; channelAccountId: string }[] = [];

    for (const channel of channels) {
      const row = await tx.publication.create({
        data: {
          channelAccountId: channel.id,
          createdByUserId: ctx.userId,
          kind: input.kind,
          name: input.name,
          copy: input.caption,
          scheduledAt: input.scheduledAt,
          status: PubStatus.SCHEDULED,
          audioId: input.audioId ?? null,
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
  if (!publication) throw new Error("Publication introuvable dans cette organisation.");

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
  if (!publication) throw new Error("Publication manquée introuvable.");

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
      asset: { select: { id: true, rating: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
