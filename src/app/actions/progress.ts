"use server";

import { requireOrgContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { readPublishProgress } from "@/temporal/client";
import type { PublishProgress } from "@/temporal/config";

export type PublicationProgress = {
  publicationId: string;
  name: string;
  platform: string;
  status: string;
  remoteId: string | null;
  failureReason: string | null;
  progress: PublishProgress | null;
};

/**
 * Avancement de publications, tel que le workflow le rapporte.
 *
 * L'état en base sert de repli: quand la rétention Temporal a effacé
 * l'historique, il reste le statut et, s'il y a lieu, la raison de l'échec.
 */
export async function readProgressAction(
  publicationIds: string[],
): Promise<PublicationProgress[]> {
  const ctx = await requireOrgContext();

  const publications = await prisma.publication.findMany({
    where: {
      id: { in: publicationIds },
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: {
      id: true,
      name: true,
      status: true,
      remoteId: true,
      failureReason: true,
      channelAccount: { select: { platform: true } },
    },
  });

  return Promise.all(
    publications.map(async (publication) => ({
      publicationId: publication.id,
      name: publication.name,
      platform: publication.channelAccount.platform,
      status: publication.status,
      remoteId: publication.remoteId,
      failureReason: publication.failureReason,
      progress: await readPublishProgress(publication.id),
    })),
  );
}
