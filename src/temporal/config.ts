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

/** Balayeur des Schedules de publication épuisés (7.6). */
export const SWEEP_PUBLISH_SCHEDULES_SCHEDULE_ID = "sweep-publish-schedules";

/**
 * Préfixe des Schedules de publication. Il sert à les reconnaître au balayage:
 * le balayeur ne doit jamais toucher `refresh-meta-tokens` ni lui-même.
 */
export const PUBLISH_SCHEDULE_PREFIX = "publish-at:";

/** Schedule à déclenchement unique portant une publication programmée (7.6). */
export function publishScheduleId(publicationId: string): string {
  return `${PUBLISH_SCHEDULE_PREFIX}${publicationId}`;
}

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

/**
 * Verdict du balayeur sur un Schedule, isolé du client Temporal pour être
 * testable: c'est la seule ligne du système capable d'effacer un Schedule
 * encore vivant, et une erreur ici perdrait une publication programmée.
 */
export type ScheduleVerdict = "foreign" | "live" | "exhausted" | "stuck";

export function classifyPublishSchedule(summary: {
  scheduleId: string;
  info: { recentActions: unknown[]; nextActionTimes: unknown[] };
}): ScheduleVerdict {
  if (!summary.scheduleId.startsWith(PUBLISH_SCHEDULE_PREFIX)) return "foreign";
  // Un déclenchement à venir: on n'y touche pas, quoi qu'il se soit passé avant.
  if (summary.info.nextActionTimes.length > 0) return "live";
  return summary.info.recentActions.length > 0 ? "exhausted" : "stuck";
}

/**
 * Connexion Telegram (4.2.1). Le login vit dans un workflow parce que MTProto
 * exige qu'un même client reste connecté entre l'envoi du code et sa
 * validation: aucun aller-retour HTTP sans état ne peut porter ça.
 */
export function telegramLoginWorkflowId(loginId: string): string {
  return `tg-login:${loginId}`;
}

export const TELEGRAM_LOGIN_STATE_QUERY = "loginState";
export const TELEGRAM_CODE_SIGNAL = "submitCode";
export const TELEGRAM_PASSWORD_SIGNAL = "submitPassword";

export type TelegramLoginState = {
  state:
    | "starting"
    | "awaiting_code"
    | "awaiting_password"
    | "connected"
    | "failed";
  /** Message destiné à l'opérateur. Jamais un secret. */
  detail: string | null;
  account: {
    channelAccountId: string;
    username: string | null;
    firstName: string | null;
    telegramUserId: number;
  } | null;
};

/** Déconnexion d'une persona Telegram, déclenchée par la suppression du canal. */
export function telegramDisconnectWorkflowId(personaId: string): string {
  return `tg-disconnect:${personaId}`;
}

export function telegramTargetsWorkflowId(personaId: string): string {
  return `tg-targets:${personaId}`;
}

export type TelegramTarget = {
  chatId: string;
  title: string;
  kind: "channel" | "group" | "user";
  /**
   * Les Stars n'existent que dans un channel qui les autorise. TDLib refuse
   * `inputMessagePaidMedia` partout ailleurs (4.2.6).
   */
  paidMediaAllowed: boolean;
};
