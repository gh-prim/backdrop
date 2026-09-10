"use server";

import { prisma } from "@/lib/db";
import { requireOrgContext } from "@/lib/session";
import { listTelegramTargets } from "@/temporal/client";
import type { TelegramTarget } from "@/temporal/config";

export type TargetsResult =
  | { ok: true; targets: TelegramTarget[] }
  | { ok: false; error: string };

/**
 * Destinations Telegram d'un canal, pour le composeur.
 *
 * Lues à la demande plutôt que stockées: un channel créé, quitté ou renommé
 * doit apparaître tel qu'il est au moment de composer, et une liste en base
 * dériverait sans que personne ne s'en aperçoive.
 */
export async function readTelegramTargetsAction(
  channelAccountId: string,
): Promise<TargetsResult> {
  const ctx = await requireOrgContext();

  const channel = await prisma.channelAccount.findFirst({
    // Scope serveur: l'organisation vient de la session (9.6).
    where: {
      id: channelAccountId,
      platform: "TELEGRAM",
      persona: { organizationId: ctx.organizationId },
    },
    select: { personaId: true },
  });
  if (!channel) return { ok: false, error: "Telegram channel not found." };

  try {
    return { ok: true, targets: await listTelegramTargets(channel.personaId) };
  } catch (error) {
    return {
      ok: false,
      error: `Telegram worker unreachable: ${(error as Error).message}`,
    };
  }
}
