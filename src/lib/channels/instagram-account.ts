import { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptCredentials } from "@/lib/crypto";
import { InstagramAdapter, type InstagramCredentials } from "./instagram";
import type { OrgContext } from "@/lib/session";

/**
 * Résolution d'un adapter Instagram côté web.
 *
 * Pendant du résolveur du worker (worker/activities/instagram.ts), avec la même
 * discipline: c'est le seul endroit du web autorisé à lire la colonne
 * `credentials`, et rien de ce qu'il déchiffre ne remonte à l'appelant — il ne
 * rend qu'un adapter, jamais un token.
 *
 * Le scope d'organisation vient de la session, comme partout (9.6).
 */
export async function instagramAdapterFor(
  ctx: OrgContext,
  channelAccountId: string,
): Promise<InstagramAdapter | null> {
  const account = await prisma.channelAccount.findFirst({
    where: {
      id: channelAccountId,
      platform: Platform.INSTAGRAM,
      persona: { organizationId: ctx.organizationId },
    },
    select: { credentials: true },
  });
  if (!account) return null;

  return new InstagramAdapter(
    decryptCredentials<InstagramCredentials>(account.credentials),
  );
}
