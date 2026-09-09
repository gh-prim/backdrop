import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  sleep,
  log,
  ApplicationFailure,
} from "@temporalio/workflow";
import type * as activities from "../activities";
import { RESCHEDULE_SIGNAL } from "../../src/temporal/config";

/**
 * Publication Instagram (spec 7.2, 4.1.3, 4.1.4).
 *
 * `workflowId = publish:{publication.id}`: Temporal refuse nativement le
 * doublon, et un double post Instagram est signalé comme spam.
 *
 * Le workflow démarre **à la programmation**, pas à l'échéance: il dort sur un
 * timer durable et accepte un signal de reprogrammation (7.6).
 */

const db = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 5, initialInterval: "1 second" },
});

const graph = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 6,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

export const rescheduleSignal = defineSignal<[string]>(RESCHEDULE_SIGNAL);

/** Bornes du polling de container (4.1.3). */
const POLL_INTERVAL_SECONDS = 5;
const POLL_MAX_ATTEMPTS = 120; // ~10 minutes, une vidéo longue peut les prendre

export type PublishInstagramInput = { publicationId: string };

export async function publishInstagram(
  input: PublishInstagramInput,
): Promise<{ outcome: "published" | "missed" | "skipped"; remoteId?: string }> {
  const initial = await db.loadPublicationPlan(input.publicationId);

  let targetAt = Date.parse(initial.scheduledAt);
  setHandler(rescheduleSignal, (isoDate: string) => {
    const next = Date.parse(isoDate);
    if (!Number.isNaN(next)) {
      log.info("Reprogrammation reçue", { from: targetAt, to: next });
      targetAt = next;
    }
  });

  // Timer durable. Une reprogrammation réveille la condition et recalcule le
  // délai, sans annuler ni redémarrer le workflow.
  while (Date.now() < targetAt) {
    await condition(() => Date.now() >= targetAt, targetAt - Date.now());
  }

  // L'état a pu changer pendant l'attente: annulation, retour en brouillon,
  // publication manuelle. On relit avant d'agir à l'extérieur.
  const plan = await db.loadPublicationPlan(input.publicationId);
  if (plan.status !== "SCHEDULED") {
    log.info("Publication non programmée au réveil, on ne touche à rien", {
      status: plan.status,
    });
    return { outcome: "skipped" };
  }

  // Tolérance de retard (7.6): publier en aveugle après une coupure est pire
  // que ne pas publier. On rend la main à l'opérateur.
  const latenessMinutes = (Date.now() - Date.parse(plan.scheduledAt)) / 60_000;
  if (latenessMinutes > plan.toleranceMinutes) {
    log.warn("Échéance dépassée au-delà de la tolérance", {
      latenessMinutes,
      toleranceMinutes: plan.toleranceMinutes,
    });
    await db.markMissed(input.publicationId);
    return { outcome: "missed" };
  }

  await db.markPublishing(input.publicationId);

  try {
    if (plan.items.length === 0) {
      throw ApplicationFailure.create({
        message: "Publication sans aucun élément.",
        nonRetryable: true,
      });
    }

    const missingUrl = plan.items.find((item) => !item.publicUrl);
    if (missingUrl) {
      // Meta fait un cURL sur l'URL au moment de la publication (4.1.6):
      // sans URL publique, il n'y a rien à tenter.
      throw ApplicationFailure.create({
        message:
          "Variant sans URL publique: le push R2 n'a pas eu lieu ou l'Asset n'est pas SFW.",
        nonRetryable: true,
      });
    }

    // Le quota est interrogé avant d'envoyer, pas encaissé en erreur 9 (4.1.8).
    const quota = await graph.checkInstagramQuota(plan.channelAccountId);
    if (quota.remaining <= 0) {
      throw ApplicationFailure.create({
        message: `Quota de publication atteint: ${quota.used}/${quota.limit} sur 24 h.`,
        nonRetryable: true,
      });
    }

    const creationId =
      plan.kind === "CAROUSEL"
        ? await buildCarousel(plan)
        : await buildSingle(plan);

    const remoteId = await graph.publishInstagramContainer(
      plan.channelAccountId,
      creationId,
    );
    await db.markPublished(input.publicationId, remoteId);

    log.info("Publication Instagram réussie", { remoteId });
    return { outcome: "published", remoteId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db.markFailed(input.publicationId, reason);
    throw error;
  }
}

async function buildSingle(
  plan: Awaited<ReturnType<typeof db.loadPublicationPlan>>,
): Promise<string> {
  const item = plan.items[0];
  const url = item.publicUrl as string;

  const containerId = await graph.createInstagramContainer(
    plan.channelAccountId,
    plan.kind === "REEL"
      ? {
          type: "REELS",
          videoUrl: url,
          caption: plan.caption,
          audioId: plan.audioId ?? undefined,
        }
      : item.isVideo
        ? { type: "VIDEO", videoUrl: url, caption: plan.caption }
        : { type: "IMAGE", imageUrl: url, caption: plan.caption },
  );

  await db.persistChildContainerId(item.itemId, containerId);
  await waitForContainer(plan.channelAccountId, containerId);
  return containerId;
}

/**
 * Carrousel: enfants en parallèle, **tous** FINISHED, puis parent (4.1.4).
 * L'échec d'un seul enfant fait échouer l'ensemble avant toute publication:
 * il n'existe pas d'état intermédiaire où un post partiel serait sorti.
 */
async function buildCarousel(
  plan: Awaited<ReturnType<typeof db.loadPublicationPlan>>,
): Promise<string> {
  if (plan.items.length > 10) {
    throw ApplicationFailure.create({
      message: `Carrousel de ${plan.items.length} éléments: 10 au maximum.`,
      nonRetryable: true,
    });
  }

  const children = await Promise.all(
    plan.items.map(async (item) => {
      const containerId = await graph.createInstagramContainer(
        plan.channelAccountId,
        item.isVideo
          ? { type: "CAROUSEL_ITEM_VIDEO", videoUrl: item.publicUrl as string }
          : { type: "CAROUSEL_ITEM_IMAGE", imageUrl: item.publicUrl as string },
      );
      await db.persistChildContainerId(item.itemId, containerId);
      return { position: item.position, containerId };
    }),
  );

  await Promise.all(
    children.map((child) => waitForContainer(plan.channelAccountId, child.containerId)),
  );

  // L'ordre du carrousel est celui de `children`, donc celui des positions.
  const ordered = [...children].sort((a, b) => a.position - b.position);

  const parentId = await graph.createInstagramContainer(plan.channelAccountId, {
    type: "CAROUSEL",
    children: ordered.map((child) => child.containerId),
    // La légende est portée par le parent, pas par les enfants (4.1.4).
    caption: plan.caption,
  });

  await waitForContainer(plan.channelAccountId, parentId);
  return parentId;
}

/**
 * Polling d'un container. Obligatoire pour les vidéos et les reels, et jamais
 * sauté pour un carrousel (4.1.3). La boucle vit dans le workflow: elle est
 * durable, reprend après un redémarrage du worker, et se lit dans Temporal UI.
 */
async function waitForContainer(
  channelAccountId: string,
  containerId: string,
): Promise<void> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const { status, error } = await graph.getInstagramContainerStatus(
      channelAccountId,
      containerId,
    );

    if (status === "FINISHED") return;

    if (status === "ERROR" || status === "EXPIRED") {
      throw ApplicationFailure.create({
        message: `Container ${containerId} en ${status}: ${error ?? "sans détail"}`,
        nonRetryable: true,
      });
    }

    await sleep(`${POLL_INTERVAL_SECONDS} seconds`);
  }

  throw ApplicationFailure.create({
    message: `Container ${containerId} toujours en cours après ${
      (POLL_MAX_ATTEMPTS * POLL_INTERVAL_SECONDS) / 60
    } minutes.`,
    nonRetryable: true,
  });
}
