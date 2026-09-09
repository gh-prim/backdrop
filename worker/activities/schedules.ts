import {
  sweepExhaustedPublishSchedules,
  type SweepResult,
} from "../../src/temporal/client";

/**
 * Activité de balayage des Schedules de publication épuisés.
 *
 * Elle vit dans une activité, pas dans le workflow: le client Temporal ouvre
 * une connexion réseau, ce que le sandbox des workflows interdit.
 */
export async function sweepPublishSchedulesActivity(): Promise<SweepResult> {
  return sweepExhaustedPublishSchedules();
}
