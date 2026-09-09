"use server";

import { requireOrgContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { readPublishProgress } from "@/temporal/client";

export type ActiveTask = {
  publicationId: string;
  name: string;
  platform: string;
  persona: string;
  status: string;
  scheduledAt: string;
  remoteId: string | null;
  failureReason: string | null;
  /** Étape en cours rapportée par le workflow, quand il en a une. */
  step: string | null;
};

const RECENTLY_SETTLED_MS = 5 * 60 * 1000;

/**
 * Tâches en cours et fraîchement terminées.
 *
 * Les terminées sont incluses quelques minutes pour que l'interface puisse
 * prévenir de ce qui vient de se produire: une publication programmée part
 * pendant que l'opérateur regarde un autre écran.
 */
export async function readActiveTasksAction(): Promise<ActiveTask[]> {
  const ctx = await requireOrgContext();
  const since = new Date(Date.now() - RECENTLY_SETTLED_MS);

  const publications = await prisma.publication.findMany({
    where: {
      channelAccount: { persona: { organizationId: ctx.organizationId } },
      OR: [
        { status: { in: ["SCHEDULED", "PUBLISHING"] } },
        { status: { in: ["PUBLISHED", "FAILED", "MISSED"] }, updatedAt: { gte: since } },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      scheduledAt: true,
      remoteId: true,
      failureReason: true,
      channelAccount: {
        select: { platform: true, persona: { select: { name: true } } },
      },
    },
    orderBy: { scheduledAt: "asc" },
    take: 30,
  });

  return Promise.all(
    publications.map(async (publication) => {
      // On n'interroge le workflow que pour ce qui bouge: une publication
      // programmée pour demain n'a rien à raconter.
      const progress =
        publication.status === "PUBLISHING"
          ? await readPublishProgress(publication.id)
          : null;

      return {
        publicationId: publication.id,
        name: publication.name,
        platform: publication.channelAccount.platform,
        persona: publication.channelAccount.persona.name,
        status: publication.status,
        scheduledAt: publication.scheduledAt.toISOString(),
        remoteId: publication.remoteId,
        failureReason: publication.failureReason,
        step:
          progress?.steps.find((entry) => entry.status === "active")?.label ?? null,
      };
    }),
  );
}
