import "server-only";
import type { Platform, Rating } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OrgContext } from "@/lib/session";

/**
 * Projection sûre d'un ChannelAccount.
 *
 * Règle absolue (spec 7.4 et 9.7): les credentials plateforme ne sont jamais
 * renvoyés au client, ni en clair ni tronqués, quel que soit le rôle. L'UI
 * affiche un état, rien d'autre. C'est la seule fonction autorisée à lire des
 * ChannelAccount pour affichage; elle ne sélectionne jamais `credentials`.
 */
export type ChannelConnectionState =
  | "connected"
  | "expiring"
  | "expired"
  | "unknown";

export type ChannelStatus = {
  id: string;
  personaId: string;
  platform: Platform;
  maxRating: Rating;
  state: ChannelConnectionState;
  expiresInDays: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Seuil d'alerte: en dessous, on prévient avant que la pipeline ne meure. */
const EXPIRING_SOON_DAYS = 7;

export function connectionState(tokenExpiresAt: Date | null, now = new Date()) {
  if (!tokenExpiresAt) {
    return { state: "unknown" as const, expiresInDays: null };
  }
  const days = Math.floor((tokenExpiresAt.getTime() - now.getTime()) / DAY_MS);
  if (days < 0) return { state: "expired" as const, expiresInDays: days };
  if (days <= EXPIRING_SOON_DAYS) return { state: "expiring" as const, expiresInDays: days };
  return { state: "connected" as const, expiresInDays: days };
}

export async function listChannelStatus(ctx: OrgContext): Promise<ChannelStatus[]> {
  const rows = await prisma.channelAccount.findMany({
    // Scope serveur: l'organisation vient de la session (9.6).
    where: { persona: { organizationId: ctx.organizationId } },
    select: {
      id: true,
      personaId: true,
      platform: true,
      maxRating: true,
      tokenExpiresAt: true,
      // `credentials` est délibérément absent. Ne pas l'ajouter.
    },
    orderBy: { platform: "asc" },
  });

  return rows.map(({ tokenExpiresAt, ...row }) => ({
    ...row,
    ...connectionState(tokenExpiresAt),
  }));
}
