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
  channelAccountId: string;
  kind: PubKind;
  caption: string;
  scheduledAt: Date;
  variantIds: string[];
  audioId?: string | null;
};

export async function createPublication(
  ctx: OrgContext,
  input: CreatePublicationInput,
): Promise<{ id: string; platform: Platform }> {
  const channel = await prisma.channelAccount.findFirst({
    where: {
      id: input.channelAccountId,
      persona: { organizationId: ctx.organizationId },
    },
    select: { id: true, platform: true },
  });
  if (!channel) throw new Error("Canal introuvable dans cette organisation.");

  // Les items sont créés dans la même transaction: le trigger de rating
  // s'exécute à l'insertion, donc une publication interdite ne laisse aucune
  // ligne derrière elle.
  const publication = await prisma.$transaction(async (tx) => {
    const created = await tx.publication.create({
      data: {
        channelAccountId: channel.id,
        createdByUserId: ctx.userId,
        kind: input.kind,
        copy: input.caption,
        scheduledAt: input.scheduledAt,
        status: PubStatus.SCHEDULED,
        audioId: input.audioId ?? null,
      },
      select: { id: true },
    });

    for (const [position, variantId] of input.variantIds.entries()) {
      await tx.publicationItem.create({
        data: { publicationId: created.id, variantId, position },
      });
    }

    return created;
  });

  return { id: publication.id, platform: channel.platform };
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
