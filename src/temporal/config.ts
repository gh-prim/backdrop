/**
 * Constantes Temporal.
 *
 * Ce module est importé par le code de **workflow**, qui s'exécute dans une
 * sandbox déterministe sans `process` ni accès au système. Il ne doit donc
 * contenir que des valeurs littérales. Tout ce qui lit l'environnement vit
 * dans ./env.ts, jamais atteint depuis un workflow.
 */

/**
 * Une task queue par worker. Telegram aura la sienne, servie par un singleton
 * (7.3): la séparation est déjà là pour ne pas avoir à la rétro-installer.
 */
export const TASK_QUEUE = {
  node: "backdrop-node",
  telegram: "backdrop-telegram",
} as const;

/** Idempotence: un workflow par publication, Temporal refuse le doublon (7.2). */
export function publishWorkflowId(publicationId: string): string {
  return `publish:${publicationId}`;
}

export function ingestWorkflowId(variantId: string): string {
  return `ingest:${variantId}`;
}

export const REFRESH_META_TOKENS_SCHEDULE_ID = "refresh-meta-tokens";

/** Signal de reprogrammation, reçu par un workflow déjà en attente (7.6). */
export const RESCHEDULE_SIGNAL = "reschedule";

/** Nom de la requête d'avancement exposée par le workflow de publication. */
export const PROGRESS_QUERY = "publishProgress";

export type PublishStep = {
  label: string;
  status: "done" | "active" | "failed";
};

/**
 * Avancement réel d'une publication.
 *
 * Alimenté par le workflow lui-même et lu par requête Temporal: ce que voit
 * l'opérateur est l'état de l'exécution, pas une animation qui l'imite.
 */
export type PublishProgress = {
  percent: number;
  state: "waiting" | "running" | "published" | "failed" | "missed" | "skipped";
  steps: PublishStep[];
  detail: string | null;
};
