import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
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
 * Publication Fanvue (spec 4.3, 7.2, 7.6).
 *
 * Même grammaire que le workflow Instagram: le workflow démarre à la
 * programmation, dort sur un timer durable, relit l'état au réveil et
 * s'arrête avant tout appel externe en simulation.
 *
 * Ce qui change tient à la plateforme: les octets partent du worker vers le
 * Vault, chaque média doit être `ready` avant d'être attaché, et la création
 * du post n'a aucune idempotence — d'où la relecture avant rejeu (4.3.9).
 */

const db = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 5, initialInterval: "1 second" },
});

const janitor = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 seconds",
  retry: { maximumAttempts: 2, initialInterval: "1 second" },
});

/** L'upload porte les octets: sa patience est celle d'un transfert, pas d'un appel. */
const upload = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  retry: { maximumAttempts: 3, initialInterval: "5 seconds" },
});

/**
 * L'attente du traitement est faite **par la politique de retry**, pas par un
 * sommeil dans l'activité: un worker qui dort tient un slot pour rien, et
 * l'historique Temporal montre alors chaque tentative.
 */
const poll = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 60,
    initialInterval: "5 seconds",
    backoffCoefficient: 1,
    nonRetryableErrorTypes: ["FANVUE_MEDIA_ERROR"],
  },
});

const api = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 5,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

export const rescheduleSignal = defineSignal<[string]>(RESCHEDULE_SIGNAL);
export const progressQuery = defineQuery<PublishProgress>(PROGRESS_QUERY);

export type PublishFanvueInput = { publicationId: string };

async function dropSchedule(publicationId: string): Promise<void> {
  try {
    await janitor.cleanupPublishSchedule(publicationId);
  } catch (error) {
    log.warn("Nettoyage du Schedule impossible, laissé au balayeur", {
      publicationId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function publishFanvue(
  input: PublishFanvueInput,
): Promise<{ outcome: "published" | "missed" | "skipped" | "dry-run"; remoteId?: string }> {
  const steps: PublishStep[] = [];
  const progress: PublishProgress = { percent: 0, state: "waiting", steps, detail: null };
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
    if (!Number.isNaN(next)) targetAt = next;
  });

  if (Date.now() < targetAt) advance(8, "Waiting for the scheduled time", "waiting");
  while (Date.now() < targetAt) {
    await condition(() => Date.now() >= targetAt, targetAt - Date.now());
  }

  const plan = await db.loadPublicationPlan(input.publicationId);
  if (plan.status !== "SCHEDULED") {
    finish("skipped", `Status is ${plan.status}: nothing was sent.`);
    await dropSchedule(input.publicationId);
    return { outcome: "skipped" };
  }

  const latenessMinutes = (Date.now() - Date.parse(plan.scheduledAt)) / 60_000;
  if (latenessMinutes > plan.toleranceMinutes) {
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

    const audience = plan.audience ?? "subscribers";
    const price = plan.priceCents ?? undefined;

    // Le teaser gratuit n'a de sens qu'avec un prix, et un prix sans média ne
    // serait pas déverrouillable: les deux se vérifient avant tout envoi.
    if (plan.previewVariantId && price === undefined) {
      throw ApplicationFailure.create({
        message: "A free preview only makes sense on a paid post.",
        nonRetryable: true,
      });
    }

    advance(18, "Checking the account");
    const account = await api.checkFanvueAccount({
      channelAccountId: plan.channelAccountId,
    });

    // Point d'arrêt de la simulation: tout ce qui pouvait l'être a été
    // vérifié — statut, échéance, cohérence prix/teaser, jeton valide. Ce qui
    // suit écrit chez Fanvue.
    if (plan.dryRun) {
      await db.markDryRun(input.publicationId);
      finish("published", `Dry run on @${account.handle}: nothing sent.`);
      await dropSchedule(input.publicationId);
      return { outcome: "dry-run" };
    }

    const mediaUuids: string[] = [];
    const total = plan.items.length + (plan.previewVariantId ? 1 : 0);
    let done = 0;

    for (const item of plan.items) {
      advance(
        20 + Math.round((done / total) * 50),
        `Uploading media ${done + 1} of ${total}`,
      );
      const { mediaUuid } = await upload.uploadFanvueMedia({
        channelAccountId: plan.channelAccountId,
        variantId: item.variantId,
      });
      // Un média encore en traitement attaché à un post donne une vignette
      // cassée: on attend `ready` avant de continuer (4.3.5).
      await poll.awaitFanvueMedia({
        channelAccountId: plan.channelAccountId,
        mediaUuid,
      });
      mediaUuids.push(mediaUuid);
      done += 1;
    }

    let previewUuid: string | undefined;
    if (plan.previewVariantId) {
      advance(72, "Uploading the free preview");
      const preview = await upload.uploadFanvueMedia({
        channelAccountId: plan.channelAccountId,
        variantId: plan.previewVariantId,
      });
      await poll.awaitFanvueMedia({
        channelAccountId: plan.channelAccountId,
        mediaUuid: preview.mediaUuid,
      });
      previewUuid = preview.mediaUuid;
    }

    advance(88, "Creating the post");
    const created = await api.createFanvuePost({
      channelAccountId: plan.channelAccountId,
      publicationId: plan.publicationId,
      audience: audience as "subscribers" | "followers-and-subscribers",
      text: plan.caption,
      mediaUuids,
      mediaPreviewUuid: previewUuid,
      priceCents: price,
    });

    await db.markPublished(input.publicationId, created.remoteId);
    advance(100, "Published");
    finish(
      "published",
      created.deduplicated
        ? `${created.remoteId} (already existed: retry matched an earlier post)`
        : created.remoteId,
    );
    await dropSchedule(input.publicationId);
    return { outcome: "published", remoteId: created.remoteId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db.markFailed(input.publicationId, reason);
    finish("failed", reason);
    await dropSchedule(input.publicationId);
    throw error;
  }
}
