import { proxyActivities, log } from "@temporalio/workflow";
import type * as activities from "../activities";

/**
 * Balayage horaire des Temporal Schedules de publication (7.6).
 *
 * Le workflow de publication supprime déjà son propre Schedule sur chacune de
 * ses sorties. Ce balayeur existe pour le cas où il n'y arrive pas — worker
 * tué, perte de connexion au moment du nettoyage. Un filet qui dépendrait du
 * mécanisme qu'il rattrape ne servirait à rien.
 */

const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3, initialInterval: "10 seconds" },
});

export async function sweepPublishSchedules() {
  const result = await act.sweepPublishSchedulesActivity();

  if (result.swept.length > 0) {
    log.info("Schedules de publication épuisés supprimés", {
      count: result.swept.length,
      scheduleIds: result.swept,
    });
  }

  // Un Schedule qui n'a jamais tiré et ne tirera jamais est autre chose qu'un
  // reliquat: sa publication est restée SCHEDULED sans que rien ne l'envoie.
  // Le supprimer sans le dire transformerait un bug visible en bug silencieux.
  if (result.stuck.length > 0) {
    log.error("Schedules jamais déclenchés: publications restées en attente", {
      count: result.stuck.length,
      scheduleIds: result.stuck,
    });
  }

  return result;
}
