import {
  Client,
  Connection,
  ScheduleOverlapPolicy,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import {
  PROGRESS_QUERY,
  classifyPublishSchedule,
  RESCHEDULE_SIGNAL,
  REFRESH_META_TOKENS_SCHEDULE_ID,
  SWEEP_PUBLISH_SCHEDULES_SCHEDULE_ID,
  TELEGRAM_CODE_SIGNAL,
  TELEGRAM_LOGIN_STATE_QUERY,
  TELEGRAM_PASSWORD_SIGNAL,
  telegramDisconnectWorkflowId,
  telegramLoginWorkflowId,
  telegramTargetsWorkflowId,
  type TelegramTarget,
  type TelegramLoginState,
  TASK_QUEUE,
  ingestWorkflowId,
  publishScheduleId,
  publishWorkflowId,
  type PublishProgress,
} from "./config";
import { TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE } from "./env";

/**
 * Client Temporal côté web.
 *
 * Le web ne fait que démarrer, signaler et annuler des workflows. Il ne
 * transporte jamais de credential: les workflows ne reçoivent que des
 * identifiants (voir worker/activities/publications.ts).
 *
 * Pas de `server-only`: ce module est aussi importé par les scripts CLI, qui
 * sont des process Node ordinaires. La garantie est reprise par le test
 * structurel tests/module-boundaries.test.ts.
 */

let cached: Promise<Client> | null = null;

export function temporalClient(): Promise<Client> {
  if (!cached) {
    cached = Connection.connect({ address: TEMPORAL_ADDRESS }).then(
      (connection) => new Client({ connection, namespace: TEMPORAL_NAMESPACE }),
    );
  }
  return cached;
}

/**
 * Démarre le workflow de publication **à la programmation**, pas à l'échéance
 * (7.6). `workflowId = publish:{id}` rend le doublon impossible (7.2).
 */
export async function startPublishWorkflow(publication: {
  id: string;
  platform: "INSTAGRAM" | "TELEGRAM" | "FANVUE";
}): Promise<void> {
  const client = await temporalClient();

  if (publication.platform !== "INSTAGRAM") {
    throw new Error(
      `Aucun workflow de publication pour ${publication.platform} à ce stade.`,
    );
  }

  try {
    await client.workflow.start("publishInstagram", {
      workflowId: publishWorkflowId(publication.id),
      taskQueue: TASK_QUEUE.node,
      args: [{ publicationId: publication.id }],
    });
  } catch (error) {
    // Un workflow déjà démarré pour cette publication est exactement ce que
    // `workflowId = publish:{id}` garantit (7.2): c'est le succès du garde-fou,
    // pas une erreur à remonter.
    //
    // Surtout, ne pas utiliser signalWithStart ici: le signal de
    // reprogrammation porterait l'heure courante et écraserait l'échéance lue
    // en base, ce qui ferait publier immédiatement.
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
}

/**
 * Programme une publication par un **Temporal Schedule à déclenchement unique**.
 */
const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
] as const;

export async function schedulePublication(
  publication: { id: string; platform: "INSTAGRAM" | "TELEGRAM" | "FANVUE" },
  at: Date,
): Promise<void> {
  if (publication.platform !== "INSTAGRAM") {
    throw new Error(`No publishing workflow for ${publication.platform} yet.`);
  }

  const client = await temporalClient();
  const scheduleId = publishScheduleId(publication.id);

  // Une reprogrammation supprime puis recrée: la mise à jour d'un Schedule
  // demande de reconstruire sa description entière, pour un objet dont la
  // durée de vie se compte en heures et qui n'a qu'un seul déclenchement.
  await unschedulePublication(publication.id);

  await client.schedule.create({
    scheduleId,
    spec: {
      // Tous les champs sont épinglés: la spécification ne désigne qu'un
      // instant. Exprimée en UTC pour ne pas dépendre du fuseau du serveur,
      // qui n'est pas celui de la persona.
      calendars: [
        {
          year: at.getUTCFullYear(),
          month: MONTHS[at.getUTCMonth()],
          dayOfMonth: at.getUTCDate(),
          hour: at.getUTCHours(),
          minute: at.getUTCMinutes(),
          second: at.getUTCSeconds(),
        },
      ],
      timezone: "UTC",
    },
    action: {
      type: "startWorkflow",
      workflowType: "publishInstagram",
      workflowId: publishWorkflowId(publication.id),
      taskQueue: TASK_QUEUE.node,
      args: [{ publicationId: publication.id }],
    },
    policies: { overlap: ScheduleOverlapPolicy.SKIP },
    // La garantie qui remplace ici l'unicité du workflowId: même si le
    // Schedule survivait à sa publication — annulation ratée, nettoyage
    // manqué — il ne peut pas se déclencher une seconde fois.
    state: { remainingActions: 1 },
  });
}

/** Retire le Schedule d'une publication: annulation, ou nettoyage après envoi. */
export async function unschedulePublication(publicationId: string): Promise<void> {
  const client = await temporalClient();
  await client.schedule
    .getHandle(publishScheduleId(publicationId))
    .delete()
    .catch(() => {
      // Absent, déjà nettoyé, ou jamais créé: rien à signaler.
    });
}

/** Reprogrammation: signal sur le workflow en cours, pas d'annulation (7.6). */
export async function rescheduleWorkflow(
  publicationId: string,
  scheduledAt: Date,
): Promise<void> {
  const client = await temporalClient();
  const handle = client.workflow.getHandle(publishWorkflowId(publicationId));
  await handle.signal(RESCHEDULE_SIGNAL, scheduledAt.toISOString());
}

export async function cancelPublishWorkflow(publicationId: string): Promise<void> {
  const client = await temporalClient();
  const handle = client.workflow.getHandle(publishWorkflowId(publicationId));
  await handle.cancel().catch(() => {
    // Un workflow déjà terminé n'est pas une erreur à remonter à l'opérateur.
  });
}

export async function startIngestWorkflow(input: {
  assetId: string;
  ratio: string;
}): Promise<string> {
  const client = await temporalClient();
  const handle = await client.workflow.start("ingestVariant", {
    workflowId: ingestWorkflowId(`${input.assetId}:${input.ratio}`),
    taskQueue: TASK_QUEUE.node,
    args: [input],
  });
  return handle.workflowId;
}

/**
 * Schedule de rafraîchissement des tokens Meta, tous les 45 jours (7.2).
 * Idempotent: appelable au démarrage sans condition.
 */
export async function ensureRefreshMetaTokensSchedule(): Promise<void> {
  const client = await temporalClient();
  try {
    await client.schedule.create({
      scheduleId: REFRESH_META_TOKENS_SCHEDULE_ID,
      spec: { intervals: [{ every: "45 days" }] },
      action: {
        type: "startWorkflow",
        workflowType: "refreshMetaTokens",
        taskQueue: TASK_QUEUE.node,
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
    });
  } catch (error) {
    if ((error as { name?: string }).name !== "ScheduleAlreadyRunning") throw error;
  }
}

export type SweepResult = {
  /** Schedules de publication examinés. */
  inspected: number;
  /** Épuisés: ils se sont déclenchés et ne se redéclencheront jamais. */
  swept: string[];
  /**
   * Bloqués: ils ne se sont **jamais** déclenchés et ne le feront jamais —
   * typiquement une échéance déjà passée à la création. Supprimés eux aussi,
   * mais listés à part: derrière chacun se cache une publication restée
   * `SCHEDULED` que plus rien ne viendra envoyer.
   */
  stuck: string[];
};

/**
 * Supprime les Temporal Schedules de publication qui ont fini leur vie.
 *
 * Le workflow nettoie déjà le sien sur chacune de ses quatre sorties, mais ce
 * nettoyage suppose qu'il aille jusqu'au bout: un worker tué entre la
 * publication et le nettoyage laisse le Schedule derrière lui. Ce balayage ne
 * dépend d'aucun workflow, et c'est tout son intérêt.
 *
 * Le critère est l'absence de déclenchement à venir. Couplé à
 * `remainingActions: 1`, il est définitif: un Schedule sans prochaine occurrence
 * ne peut pas en retrouver une.
 */
export async function sweepExhaustedPublishSchedules(): Promise<SweepResult> {
  const client = await temporalClient();
  const swept: string[] = [];
  const stuck: string[] = [];
  let inspected = 0;

  for await (const summary of client.schedule.list()) {
    const verdict = classifyPublishSchedule(summary);
    // Ne jamais toucher aux Schedules qui ne portent pas une publication,
    // ni à ceux qui ont encore un déclenchement devant eux.
    if (verdict === "foreign") continue;
    inspected += 1;
    if (verdict === "live") continue;

    await client.schedule
      .getHandle(summary.scheduleId)
      .delete()
      .catch(() => {
        // Course avec le nettoyage du workflow: il a gagné, tant mieux.
      });

    if (verdict === "exhausted") swept.push(summary.scheduleId);
    else stuck.push(summary.scheduleId);
  }

  return { inspected, swept, stuck };
}

/** Schedule du balayeur, toutes les heures. Idempotent. */
export async function ensureSweepPublishSchedulesSchedule(): Promise<void> {
  const client = await temporalClient();
  try {
    await client.schedule.create({
      scheduleId: SWEEP_PUBLISH_SCHEDULES_SCHEDULE_ID,
      spec: { intervals: [{ every: "1 hour" }] },
      action: {
        type: "startWorkflow",
        workflowType: "sweepPublishSchedules",
        taskQueue: TASK_QUEUE.node,
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
    });
  } catch (error) {
    if ((error as { name?: string }).name !== "ScheduleAlreadyRunning") throw error;
  }
}

/**
 * Avancement réel d'une publication, lu par requête Temporal.
 *
 * Renvoie `null` si le workflow n'existe plus: l'historique est purgé au bout
 * de la rétention, et une publication ancienne n'a plus rien à raconter.
 */
export async function readPublishProgress(
  publicationId: string,
): Promise<PublishProgress | null> {
  const client = await temporalClient();
  try {
    return await client.workflow
      .getHandle(publishWorkflowId(publicationId))
      .query<PublishProgress, []>(PROGRESS_QUERY);
  } catch {
    return null;
  }
}

/**
 * Démarre une connexion Telegram et laisse le workflow attendre le code.
 *
 * La task queue est celle du worker Python: c'est lui qui détient Hydrogram et
 * le client MTProto resté connecté (7.3).
 */
export async function startTelegramLogin(input: {
  loginId: string;
  personaId: string;
  phone: string;
}): Promise<void> {
  const client = await temporalClient();
  await client.workflow.start("telegramLogin", {
    workflowId: telegramLoginWorkflowId(input.loginId),
    taskQueue: TASK_QUEUE.telegram,
    args: [input],
    // Un login abandonné ne doit pas retenir un client MTProto indéfiniment.
    workflowExecutionTimeout: "30 minutes",
  });
}

export async function sendTelegramLoginCode(
  loginId: string,
  code: string,
): Promise<void> {
  const client = await temporalClient();
  await client.workflow
    .getHandle(telegramLoginWorkflowId(loginId))
    .signal(TELEGRAM_CODE_SIGNAL, code);
}

export async function sendTelegramLoginPassword(
  loginId: string,
  password: string,
): Promise<void> {
  const client = await temporalClient();
  await client.workflow
    .getHandle(telegramLoginWorkflowId(loginId))
    .signal(TELEGRAM_PASSWORD_SIGNAL, password);
}

export async function readTelegramLoginState(
  loginId: string,
): Promise<TelegramLoginState | null> {
  const client = await temporalClient();
  try {
    return await client.workflow
      .getHandle(telegramLoginWorkflowId(loginId))
      .query<TelegramLoginState, []>(TELEGRAM_LOGIN_STATE_QUERY);
  } catch {
    return null;
  }
}

/** Abandon explicite: le workflow libère le client MTProto en sortant. */
export async function cancelTelegramLogin(loginId: string): Promise<void> {
  const client = await temporalClient();
  await client.workflow
    .getHandle(telegramLoginWorkflowId(loginId))
    .cancel()
    .catch(() => {
      // Déjà terminé: rien à signaler.
    });
}

/**
 * Ferme la session Telegram d'une persona et efface sa base côté worker.
 *
 * Attend le résultat: supprimer la ligne en base avant que le worker n'ait
 * lâché le répertoire laisserait une persona « supprimée » que le prochain
 * démarrage rouvrirait.
 */
export async function disconnectTelegramSession(personaId: string): Promise<void> {
  const client = await temporalClient();
  const handle = await client.workflow.start("telegramDisconnect", {
    workflowId: telegramDisconnectWorkflowId(personaId),
    taskQueue: TASK_QUEUE.telegram,
    args: [{ personaId }],
    workflowExecutionTimeout: "2 minutes",
  });
  await handle.result();
}

/**
 * Destinations Telegram d'une persona, lues par le composeur.
 *
 * Passe par un workflow parce que seul le worker Python parle à TDLib. Court,
 * synchrone, et jeté aussitôt: il ne s'agit que de remplir un menu.
 */
export async function listTelegramTargets(
  personaId: string,
): Promise<TelegramTarget[]> {
  const client = await temporalClient();
  const handle = await client.workflow.start("telegramTargets", {
    workflowId: telegramTargetsWorkflowId(personaId),
    taskQueue: TASK_QUEUE.telegram,
    args: [{ personaId }],
    workflowExecutionTimeout: "3 minutes",
    // Une lecture rejouée n'a aucun effet de bord: reprendre la plus récente
    // plutôt que d'échouer sur un doublon.
    workflowIdReusePolicy: WorkflowIdReusePolicy.TERMINATE_IF_RUNNING,
  });
  const result = (await handle.result()) as { targets: TelegramTarget[] };
  return result.targets;
}

/**
 * Programme une publication Telegram par un Schedule à déclenchement unique,
 * comme pour Instagram — seule la task queue change.
 */
export async function scheduleTelegramPublication(
  publicationId: string,
  at: Date,
): Promise<void> {
  const client = await temporalClient();
  await unschedulePublication(publicationId);

  await client.schedule.create({
    scheduleId: publishScheduleId(publicationId),
    spec: {
      calendars: [
        {
          year: at.getUTCFullYear(),
          month: MONTHS[at.getUTCMonth()],
          dayOfMonth: at.getUTCDate(),
          hour: at.getUTCHours(),
          minute: at.getUTCMinutes(),
          second: at.getUTCSeconds(),
        },
      ],
      timezone: "UTC",
    },
    action: {
      type: "startWorkflow",
      workflowType: "publishTelegram",
      workflowId: publishWorkflowId(publicationId),
      taskQueue: TASK_QUEUE.telegram,
      args: [{ publicationId }],
    },
    policies: { overlap: ScheduleOverlapPolicy.SKIP },
    // La garantie qui remplace l'unicité du workflowId: Temporal suffixe
    // l'identifiant par l'horodatage de l'occurrence.
    state: { remainingActions: 1 },
  });
}

/**
 * Programme une publication Fanvue (4.3.8).
 *
 * `publishAt` existe côté Fanvue et n'est pas utilisé: l'horloge appartient à
 * l'application sur tous les canaux (7.6). Le Schedule Temporal démarre donc
 * le workflow, qui attend lui-même l'échéance.
 */
export async function scheduleFanvuePublication(
  publicationId: string,
  at: Date,
): Promise<void> {
  const client = await temporalClient();
  await unschedulePublication(publicationId);

  await client.schedule.create({
    scheduleId: publishScheduleId(publicationId),
    spec: {
      calendars: [
        {
          year: at.getUTCFullYear(),
          month: MONTHS[at.getUTCMonth()],
          dayOfMonth: at.getUTCDate(),
          hour: at.getUTCHours(),
          minute: at.getUTCMinutes(),
          second: at.getUTCSeconds(),
        },
      ],
      timezone: "UTC",
    },
    action: {
      type: "startWorkflow",
      workflowType: "publishFanvue",
      workflowId: publishWorkflowId(publicationId),
      taskQueue: TASK_QUEUE.node,
      args: [{ publicationId }],
    },
    policies: { overlap: ScheduleOverlapPolicy.SKIP },
    state: { remainingActions: 1 },
  });
}

/** Démarre la publication Fanvue immédiatement, à la programmation (7.6). */
export async function startFanvuePublishWorkflow(
  publicationId: string,
): Promise<void> {
  const client = await temporalClient();
  try {
    await client.workflow.start("publishFanvue", {
      workflowId: publishWorkflowId(publicationId),
      taskQueue: TASK_QUEUE.node,
      args: [{ publicationId }],
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
}

/** Démarre la publication Telegram, à la programmation (7.6). */
export async function startTelegramPublishWorkflow(
  publicationId: string,
): Promise<void> {
  const client = await temporalClient();
  try {
    await client.workflow.start("publishTelegram", {
      workflowId: publishWorkflowId(publicationId),
      taskQueue: TASK_QUEUE.telegram,
      args: [{ publicationId }],
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
}
