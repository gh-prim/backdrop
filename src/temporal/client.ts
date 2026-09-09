import {
  Client,
  Connection,
  ScheduleOverlapPolicy,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";
import {
  RESCHEDULE_SIGNAL,
  REFRESH_META_TOKENS_SCHEDULE_ID,
  TASK_QUEUE,
  ingestWorkflowId,
  publishWorkflowId,
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
