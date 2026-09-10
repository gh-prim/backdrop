import "server-only";
import { prisma } from "@/lib/db";
import { decryptCredentials, encryptCredentials } from "@/lib/crypto";
import type { OrgContext } from "@/lib/session";

/**
 * Identifiants de l'application OAuth Fanvue, à l'échelle de l'organisation.
 *
 * Ils vivent en base, chiffrés, saisis depuis l'application — jamais dans un
 * fichier d'environnement. Même règle que l'app Telegram (4.2.1): ce qui est
 * saisi dans un `.env` finit copié dans un canal Slack.
 */
export type FanvueAppCredentials = {
  clientId: string;
  clientSecret: string;
  /** Doit correspondre **exactement** à celui déclaré chez Fanvue. */
  redirectUri: string;
};

export async function saveFanvueApp(
  ctx: OrgContext,
  credentials: FanvueAppCredentials,
): Promise<void> {
  const blob = encryptCredentials(credentials);
  await prisma.fanvueApp.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, credentials: blob },
    update: { credentials: blob },
  });
}

/** Ne rend que la présence: la valeur ne remonte jamais au navigateur (9.7). */
export async function fanvueAppConfigured(ctx: OrgContext): Promise<boolean> {
  const app = await prisma.fanvueApp.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { id: true },
  });
  return app !== null;
}

/** Réservé au serveur: routes OAuth et actions de connexion. */
export async function readFanvueApp(
  organizationId: string,
): Promise<FanvueAppCredentials | null> {
  const app = await prisma.fanvueApp.findUnique({
    where: { organizationId },
    select: { credentials: true },
  });
  return app ? decryptCredentials<FanvueAppCredentials>(app.credentials) : null;
}

export async function deleteFanvueApp(ctx: OrgContext): Promise<void> {
  await prisma.fanvueApp.deleteMany({ where: { organizationId: ctx.organizationId } });
}
