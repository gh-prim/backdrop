import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  sleep,
  log,
  ApplicationFailure,
} from "@temporalio/workflow";
import type * as activities from "../activities";
import {
  PROGRESS_QUERY,
  RESCHEDULE_SIGNAL,
  type PublishProgress,
  type PublishStep,
} from "../../src/temporal/config";

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

/**
 * Le nettoyage du Schedule est cosmétique: `remainingActions: 1` interdit déjà
 * un second déclenchement, et le balayeur horaire rattrape ce qui reste. Il ne
 * doit donc jamais faire échouer un workflow dont la publication est déjà
 * partie sur Instagram — d'où sa patience courte, et le `try` qui l'entoure.
 */
const janitor = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 seconds",
  retry: { maximumAttempts: 2, initialInterval: "1 second" },
});

/** ffmpeg peut prendre du temps: sa propre patience, séparée du reste. */
const media = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3, initialInterval: "5 seconds" },
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

/**
 * Avancement interrogeable.
 *
 * L'interface le lit par requête Temporal plutôt que d'animer une barre au
 * hasard: ce qui s'affiche est l'état réel de l'exécution, y compris quand
 * elle patiente sur un container qui met deux minutes à finir.
 */
export const progressQuery = defineQuery<PublishProgress>(PROGRESS_QUERY);

/** Bornes du polling de container (4.1.3). */
const POLL_INTERVAL_SECONDS = 5;
const POLL_MAX_ATTEMPTS = 120; // ~10 minutes, une vidéo longue peut les prendre

export type PublishInstagramInput = { publicationId: string };

/** Retire le Schedule sans jamais compromettre l'issue de la publication. */
async function dropSchedule(publicationId: string): Promise<void> {
  try {
    await janitor.cleanupPublishSchedule(publicationId);
  } catch (error) {
    // Le balayeur horaire s'en chargera: rien d'autre à faire ici.
    log.warn("Nettoyage du Schedule impossible, laissé au balayeur", {
      publicationId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function publishInstagram(
  input: PublishInstagramInput,
): Promise<{ outcome: "published" | "missed" | "skipped" | "dry-run"; remoteId?: string }> {
  const steps: PublishStep[] = [];
  const progress: PublishProgress = {
    percent: 0,
    state: "waiting",
    steps,
    detail: null,
  };
  setHandler(progressQuery, () => progress);

  function advance(
    percent: number,
    label: string,
    state: PublishProgress["state"] = "running",
  ) {
    for (const step of steps) if (step.status === "active") step.status = "done";
    steps.push({ label, status: "active" });
    progress.percent = percent;
    progress.state = state;
  }

  function finish(state: PublishProgress["state"], detail: string | null = null) {
    for (const step of steps) {
      if (step.status === "active") {
        step.status = state === "published" ? "done" : "failed";
      }
    }
    progress.percent = state === "published" ? 100 : progress.percent;
    progress.state = state;
    progress.detail = detail;
  }

  advance(4, "Reading the publication", "waiting");
  const initial = await db.loadPublicationPlan(input.publicationId);

  let targetAt = Date.parse(initial.scheduledAt);
  setHandler(rescheduleSignal, (isoDate: string) => {
    const next = Date.parse(isoDate);
    if (!Number.isNaN(next)) {
      log.info("Reprogrammation reçue", { from: targetAt, to: next });
      targetAt = next;
    }
  });

  if (Date.now() < targetAt) advance(8, "Waiting for the scheduled time", "waiting");

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
    finish("skipped", `Status is ${plan.status}: nothing was sent.`);
    await dropSchedule(input.publicationId);
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
    finish(
      "missed",
      `Overdue by ${Math.round(latenessMinutes)} min, tolerance is ${plan.toleranceMinutes} min.`,
    );
    await dropSchedule(input.publicationId);
    return { outcome: "missed" };
  }

  advance(12, "Preparing");
  await db.markPublishing(input.publicationId);

  try {
    if (plan.items.length === 0) {
      throw ApplicationFailure.create({
        message: "Publication has no items.",
        nonRetryable: true,
      });
    }

    const missingUrl = plan.items.find((item) => !item.publicUrl);
    if (missingUrl) {
      // Meta fait un cURL sur l'URL au moment de la publication (4.1.6):
      // sans URL publique, il n'y a rien à tenter.
      throw ApplicationFailure.create({
        message:
          "Variant has no public URL: the R2 push did not happen, or the asset is not SFW.",
        nonRetryable: true,
      });
    }

    advance(18, "Checking the publishing quota");
    // Le quota est interrogé avant d'envoyer, pas encaissé en erreur 9 (4.1.8).
    const quota = await graph.checkInstagramQuota(plan.channelAccountId);
    if (quota.remaining <= 0) {
      throw ApplicationFailure.create({
        message: `Publishing quota reached: ${quota.used}/${quota.limit} over 24 h.`,
        nonRetryable: true,
      });
    }

    // Point d'arrêt de la simulation: tout ce qui pouvait être vérifié l'a
    // été — statut, échéance, rating par le trigger à l'insertion, URL
    // publique de chaque variante, quota du compte. Ce qui suit crée des
    // containers chez Meta, donc a des effets hors de chez nous.
    if (plan.dryRun) {
      await db.markDryRun(input.publicationId);
      finish("published", "Dry run: everything checked, nothing sent.");
      await dropSchedule(input.publicationId);
      return { outcome: "dry-run" };
    }

    const creationId =
      plan.kind === "CAROUSEL"
        ? await buildCarousel(plan, advance)
        : await buildSingle(plan, advance);

    advance(92, "Publishing");
    const remoteId = await graph.publishInstagramContainer(
      plan.channelAccountId,
      creationId,
    );
    await db.markPublished(input.publicationId, remoteId);

    advance(100, "Published");
    finish("published", remoteId);
    await dropSchedule(input.publicationId);
    log.info("Publication Instagram réussie", { remoteId });
    return { outcome: "published", remoteId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db.markFailed(input.publicationId, reason);
    finish("failed", reason);
    // Le Schedule a joué son unique déclenchement: le laisser n'apporte rien.
    await dropSchedule(input.publicationId);
    throw error;
  }
}

type Advance = (percent: number, label: string) => void;

async function buildSingle(
  plan: Awaited<ReturnType<typeof db.loadPublicationPlan>>,
  advance: Advance,
): Promise<string> {
  const item = plan.items[0];
  let url = item.publicUrl as string;

  // Reel demandé sur une photo: l'API n'accepte aucun audio sur un container
  // IMAGE (4.1.5), donc on fabrique une vidéo à partir de l'image. C'est ce
  // que fait l'app mobile quand on pose une musique sur un post photo.
  if (plan.kind === "REEL" && !item.isVideo) {
    advance(28, "Rendering the photo as a video");
    const rendered = await media.renderStillAsReel(item.variantId);
    if (!rendered.publicUrl) {
      throw ApplicationFailure.create({
        message:
          rendered.skipped === "not_sfw"
            ? "A photo Reel requires an SFW asset: without a public URL, Meta has nothing to fetch."
            : "Photo Reel rendered but not pushed to R2: no public URL to hand to Meta.",
        nonRetryable: true,
      });
    }
    url = rendered.publicUrl;
  }

  advance(45, "Creating the container");
  const containerId = await graph.createInstagramContainer(
    plan.channelAccountId,
    plan.kind === "REEL"
      ? {
          type: "REELS",
          videoUrl: url,
          caption: plan.caption,
          audioId: plan.audioId ?? undefined,
          audioVolume: plan.audioVolume ?? undefined,
          videoVolume: plan.videoVolume ?? undefined,
        }
      : item.isVideo
        ? { type: "VIDEO", videoUrl: url, caption: plan.caption }
        : { type: "IMAGE", imageUrl: url, caption: plan.caption },
  );

  await db.persistChildContainerId(item.itemId, containerId);
  advance(70, "Waiting for Instagram to process the media");
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
  advance: Advance,
): Promise<string> {
  if (plan.items.length > 10) {
    throw ApplicationFailure.create({
      message: `Carousel of ${plan.items.length} items: 10 maximum.`,
      nonRetryable: true,
    });
  }

  advance(25, `Creating ${plan.items.length} child containers`);
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

  advance(50, `Waiting for the ${children.length} children to be processed`);
  await Promise.all(
    children.map((child) => waitForContainer(plan.channelAccountId, child.containerId)),
  );

  // L'ordre du carrousel est celui de `children`, donc celui des positions.
  const ordered = [...children].sort((a, b) => a.position - b.position);

  advance(78, "Assembling the carousel");
  const parentId = await graph.createInstagramContainer(plan.channelAccountId, {
    type: "CAROUSEL",
    children: ordered.map((child) => child.containerId),
    // La légende est portée par le parent, pas par les enfants (4.1.4).
    caption: plan.caption,
  });

  advance(86, "Waiting for the carousel to be ready");
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
        message: `Container ${containerId} is ${status}: ${error ?? "no detail"}`,
        nonRetryable: true,
      });
    }

    await sleep(`${POLL_INTERVAL_SECONDS} seconds`);
  }

  throw ApplicationFailure.create({
    message: `Container ${containerId} still processing after ${
      (POLL_MAX_ATTEMPTS * POLL_INTERVAL_SECONDS) / 60
    } minutes.`,
    nonRetryable: true,
  });
}
