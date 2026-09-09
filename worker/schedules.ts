import "dotenv/config";
import {
  ensureRefreshMetaTokensSchedule,
  ensureSweepPublishSchedulesSchedule,
} from "../src/temporal/client";

/**
 * Enregistre les Temporal Schedules permanents. À lancer une fois après un
 * `docker compose up`, ou au déploiement.
 *
 *   pnpm worker:schedules
 *
 * Les Schedules de publication, eux, sont créés à la volée par le composer et
 * ne passent pas par ici.
 */
Promise.all([
  ensureRefreshMetaTokensSchedule(),
  ensureSweepPublishSchedulesSchedule(),
])
  .then(() => {
    console.log("Schedule refresh-meta-tokens en place (tous les 45 jours).");
    console.log("Schedule sweep-publish-schedules en place (toutes les heures).");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Échec de l'enregistrement des schedules:", error);
    process.exit(1);
  });
