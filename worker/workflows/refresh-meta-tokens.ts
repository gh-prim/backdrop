import { proxyActivities, log } from "@temporalio/workflow";
import type * as activities from "../activities";

/**
 * Rafraîchissement des long-lived tokens Meta (spec 7.2, 4.1.9).
 *
 * Le token expire à 60 jours. Sans ce job, la pipeline meurt silencieusement,
 * ce qui est le pire mode de panne: rien ne casse, les publications échouent
 * simplement toutes, un jour, sans raison visible.
 *
 * Lancé par un Temporal Schedule tous les 45 jours.
 */

const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 4, initialInterval: "10 seconds" },
});

export type RefreshMetaTokensResult = {
  refreshed: string[];
  failed: { channelAccountId: string; reason: string }[];
};

export async function refreshMetaTokens(): Promise<RefreshMetaTokensResult> {
  const accountIds = await act.listInstagramChannelAccountIds();
  const refreshed: string[] = [];
  const failed: { channelAccountId: string; reason: string }[] = [];

  // Séquentiel et tolérant: l'échec d'un compte ne doit pas empêcher les
  // autres d'être rafraîchis. C'est la règle d'or de la section 3 appliquée
  // aux tokens.
  for (const channelAccountId of accountIds) {
    try {
      const { expiresAt } = await act.refreshInstagramToken(channelAccountId);
      refreshed.push(channelAccountId);
      log.info("Token Meta rafraîchi", { channelAccountId, expiresAt });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ channelAccountId, reason });
      log.error("Échec de refresh Meta", { channelAccountId, reason });
    }
  }

  // Alerting sur échec de refresh (9.5): remonté par le résultat du workflow,
  // visible dans Temporal UI. Un canal d'alerte réel viendra avec la phase 2.
  return { refreshed, failed };
}
