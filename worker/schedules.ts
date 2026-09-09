import "dotenv/config";
import { ensureRefreshMetaTokensSchedule } from "../src/temporal/client";

/**
 * Enregistre les Temporal Schedules. À lancer une fois après un
 * `docker compose up`, ou au déploiement.
 *
 *   pnpm worker:schedules
 */
ensureRefreshMetaTokensSchedule()
  .then(() => {
    console.log("Schedule refresh-meta-tokens en place (tous les 45 jours).");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Échec de l'enregistrement des schedules:", error);
    process.exit(1);
  });
