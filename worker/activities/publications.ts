import { ApplicationFailure } from "@temporalio/activity";
import { PubStatus } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { DEFAULT_SCHEDULE_TOLERANCE_MINUTES } from "../../src/temporal/env";

/**
 * Activités de persistance.
 *
 * Règle qui structure tout ce fichier: **aucun credential ne remonte au
 * workflow**. Les entrées et sorties d'activité sont écrites dans l'historique
 * Temporal, donc dans la base de Temporal. Un token Meta qui traverse un
 * workflow est un token stocké en clair dans un second système.
 *
 * Conséquence: le workflow ne manipule que des identifiants, et chaque
 * activité qui a besoin d'un secret va le chercher elle-même (7.4, 9.7).
 */

export type PublicationItemPlan = {
  itemId: string;
  variantId: string;
  position: number;
  /** URL publique R2, seule forme que Meta sache consommer (4.1.6). */
  publicUrl: string | null;
  isVideo: boolean;
};

export type PublicationPlan = {
  publicationId: string;
  channelAccountId: string;
  platform: string;
  kind: string;
  caption: string;
  audioId: string | null;
  audioVolume: number | null;
  videoVolume: number | null;
  scheduledAt: string;
  status: string;
  toleranceMinutes: number;
  items: PublicationItemPlan[];
};

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

function looksLikeVideo(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && VIDEO_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function publicUrl(r2Key: string | null): string | null {
  if (!r2Key) return null;
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${r2Key}`;
}

export async function loadPublicationPlan(
  publicationId: string,
): Promise<PublicationPlan> {
  const publication = await prisma.publication.findUnique({
    where: { id: publicationId },
    select: {
      id: true,
      channelAccountId: true,
      kind: true,
      copy: true,
      audioId: true,
      audioVolume: true,
      videoVolume: true,
      scheduledAt: true,
      status: true,
      channelAccount: {
        select: { platform: true, scheduleToleranceMinutes: true },
      },
      items: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          variantId: true,
          position: true,
          variant: { select: { r2Key: true, localPath: true } },
        },
      },
    },
  });

  if (!publication) {
    throw ApplicationFailure.create({
      message: `Publication ${publicationId} introuvable.`,
      nonRetryable: true,
    });
  }

  return {
    publicationId: publication.id,
    channelAccountId: publication.channelAccountId,
    platform: publication.channelAccount.platform,
    kind: publication.kind,
    caption: publication.copy,
    audioId: publication.audioId,
    audioVolume: publication.audioVolume,
    videoVolume: publication.videoVolume,
    scheduledAt: publication.scheduledAt.toISOString(),
    status: publication.status,
    toleranceMinutes:
      publication.channelAccount.scheduleToleranceMinutes ??
      DEFAULT_SCHEDULE_TOLERANCE_MINUTES,
    items: publication.items.map((item) => ({
      itemId: item.id,
      variantId: item.variantId,
      position: item.position,
      publicUrl: publicUrl(item.variant.r2Key),
      isVideo: looksLikeVideo(item.variant.localPath),
    })),
  };
}

export async function markPublishing(publicationId: string): Promise<void> {
  await prisma.publication.update({
    where: { id: publicationId },
    data: { status: PubStatus.PUBLISHING, failureReason: null },
  });
}

export async function markPublished(
  publicationId: string,
  remoteId: string,
): Promise<void> {
  await prisma.publication.update({
    where: { id: publicationId },
    data: {
      status: PubStatus.PUBLISHED,
      remoteId,
      publishedAt: new Date(),
      failureReason: null,
    },
  });
}

export async function markFailed(
  publicationId: string,
  reason: string,
): Promise<void> {
  await prisma.publication.update({
    where: { id: publicationId },
    // La raison est tronquée: elle est lue par un opérateur dans une table,
    // pas par un ingénieur dans un log.
    data: { status: PubStatus.FAILED, failureReason: reason.slice(0, 500) },
  });
}

/**
 * Échéance dépassée au-delà de la tolérance (7.6). Ce n'est pas un échec:
 * rien n'a été tenté à l'extérieur, et un opérateur tranche.
 */
export async function markMissed(publicationId: string): Promise<void> {
  await prisma.publication.update({
    where: { id: publicationId },
    data: {
      status: PubStatus.MISSED,
      failureReason: null,
    },
  });
}

/** Container enfant Instagram, transitoire (8). Utile au debug d'un carrousel. */
export async function persistChildContainerId(
  itemId: string,
  containerId: string,
): Promise<void> {
  await prisma.publicationItem.update({
    where: { id: itemId },
    data: { childContainerId: containerId },
  });
}
