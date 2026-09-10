import { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptCredentials, encryptCredentials } from "@/lib/crypto";
import {
  FanvueAdapter,
  refreshTokens,
  type FanvueCredentials,
} from "./fanvue";

/**
 * Résolution d'un adapter Fanvue, avec rafraîchissement **sérialisé**.
 *
 * Le refresh token de Fanvue est à usage unique: chaque échange en rend un
 * nouveau, et réutiliser un jeton déjà consommé invalide toute la chaîne —
 * la persona doit alors être réautorisée à la main (4.3.3).
 *
 * Deux workers qui rafraîchissent le même compte en parallèle produisent
 * exactement cette situation. Le verrou consultatif Postgres, pris sur
 * l'identifiant du compte, est donc une condition de correction et non une
 * optimisation: c'est le pendant Fanvue du singleton Telegram (4.2.2).
 *
 * Le verrou ne couvre que l'échange et sa persistance, jamais la publication:
 * tenir une transaction ouverte pendant l'upload d'une vidéo bloquerait le
 * compte pour des minutes.
 */

/** Marge avant expiration. En deçà, on renouvelle plutôt que de risquer un 401. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function readCredentials(channelAccountId: string) {
  const account = await prisma.channelAccount.findFirst({
    where: { id: channelAccountId, platform: Platform.FANVUE },
    select: { credentials: true },
  });
  return account ? decryptCredentials<FanvueCredentials>(account.credentials) : null;
}

async function persist(channelAccountId: string, next: FanvueCredentials) {
  await prisma.channelAccount.update({
    where: { id: channelAccountId },
    data: {
      credentials: encryptCredentials(next),
      // Sert l'état affiché dans les réglages: un compte dont le jeton a
      // expiré doit se voir avant d'échouer à la publication.
      tokenExpiresAt: new Date(next.expiresAt),
    },
  });
}

/**
 * Renouvelle si nécessaire, sous verrou, et rend les credentials à jour.
 *
 * Relit **dans** le verrou: si un autre processus vient de renouveler, on
 * repart de son résultat au lieu de consommer un jeton déjà mort.
 */
export async function freshCredentials(
  channelAccountId: string,
): Promise<FanvueCredentials | null> {
  const current = await readCredentials(channelAccountId);
  if (!current) return null;
  if (current.expiresAt > Date.now() + REFRESH_MARGIN_MS) return current;

  return prisma.$transaction(async (tx) => {
    // Clé du verrou: l'identifiant du compte, réduit à un entier par Postgres.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fanvue:${channelAccountId}`}))`;

    const row = await tx.channelAccount.findUnique({
      where: { id: channelAccountId },
      select: { credentials: true },
    });
    if (!row) return null;

    const inside = decryptCredentials<FanvueCredentials>(row.credentials);
    if (inside.expiresAt > Date.now() + REFRESH_MARGIN_MS) return inside;

    const tokens = await refreshTokens({
      clientId: inside.clientId,
      clientSecret: inside.clientSecret,
      refreshToken: inside.refreshToken,
    });

    const next: FanvueCredentials = {
      ...inside,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? inside.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };

    await tx.channelAccount.update({
      where: { id: channelAccountId },
      data: {
        credentials: encryptCredentials(next),
        tokenExpiresAt: new Date(next.expiresAt),
      },
    });

    return next;
  });
}

/**
 * Adapter prêt à l'emploi. Comme côté Instagram, rien de déchiffré ne remonte
 * à l'appelant: il ne reçoit qu'un adapter, jamais un jeton (9.7).
 */
export async function fanvueAdapterFor(
  channelAccountId: string,
): Promise<FanvueAdapter | null> {
  const credentials = await freshCredentials(channelAccountId);
  if (!credentials) return null;

  return new FanvueAdapter(credentials, async (next) => {
    // Renouvellement survenu en cours d'appel: on persiste tout de suite,
    // l'ancien jeton ne vaut déjà plus rien.
    await persist(channelAccountId, next);
  });
}
