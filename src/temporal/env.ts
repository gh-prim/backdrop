/**
 * Configuration lue dans l'environnement.
 *
 * Jamais importé depuis un workflow: la sandbox n'a pas `process` (voir
 * ./config.ts). Réservé au worker, au client et aux activités.
 */

export const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
export const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";

/** Tolérance de retard par défaut, en minutes (7.6). */
export const DEFAULT_SCHEDULE_TOLERANCE_MINUTES = Number(
  process.env.SCHEDULE_TOLERANCE_MINUTES ?? 45,
);
