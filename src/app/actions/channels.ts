"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Platform, Rating } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { encryptCredentials } from "@/lib/crypto";
import { InstagramAdapter } from "@/lib/channels/instagram";
import { disconnectTelegramSession } from "@/temporal/client";
import { ChannelError } from "@/lib/channels/types";

const schema = z.object({
  personaId: z.string().min(1),
  igUserId: z.string().min(1, "ig_user_id required."),
  accessToken: z.string().min(20, "Token too short."),
  pageId: z.string().optional(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Connexion d'un compte Instagram (7.4: réservé à `owner`).
 *
 * Trois choses se passent ici, dans cet ordre:
 *
 *  1. **Échange du token.** Le Graph API Explorer délivre un token de courte
 *     durée, une heure ou deux. Le stocker tel quel donnerait une connexion
 *     morte avant le premier passage de `refreshMetaTokens`. On l'échange donc
 *     immédiatement contre un long-lived, et on garde la date d'expiration
 *     renvoyée par Meta plutôt qu'une estimation (4.1.9).
 *  2. **Vérification.** Un appel à `content_publishing_limit` prouve que le
 *     couple token + ig_user_id fonctionne. Mieux vaut échouer ici, devant
 *     l'opérateur, qu'à l'heure de la première publication programmée.
 *  3. **Chiffrement.** Le token n'est jamais relu vers le client (9.7), et
 *     `maxRating` est forcé à SFW: c'est une propriété du canal Instagram,
 *     pas un réglage (spec 8).
 */
export async function connectInstagramAccountAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOwner();
  const parsed = schema.safeParse({
    personaId: formData.get("personaId"),
    igUserId: String(formData.get("igUserId") ?? "").trim(),
    accessToken: String(formData.get("accessToken") ?? "").trim(),
    pageId: String(formData.get("pageId") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const persona = await prisma.persona.findFirst({
    where: { id: parsed.data.personaId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!persona) return { ok: false, error: "Persona not found." };

  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return {
      ok: false,
      error:
        "META_APP_ID and META_APP_SECRET are missing from the environment: the token cannot be exchanged for a long-lived one.",
    };
  }

  const submitted = new InstagramAdapter({
    igUserId: parsed.data.igUserId,
    accessToken: parsed.data.accessToken,
  });

  let accessToken: string;
  let tokenExpiresAt: Date;
  try {
    const exchanged = await submitted.refreshLongLivedToken();
    accessToken = exchanged.accessToken;
    tokenExpiresAt = exchanged.expiresAt;
  } catch (error) {
    const detail = error instanceof ChannelError ? error.message : String(error);
    return { ok: false, error: `Token exchange refused by Meta: ${detail}` };
  }

  try {
    await new InstagramAdapter({
      igUserId: parsed.data.igUserId,
      accessToken,
    }).checkQuota();
  } catch (error) {
    const detail = error instanceof ChannelError ? error.message : String(error);
    return {
      ok: false,
      error: `Token accepted but the account does not answer (${detail}). Check the ig_user_id, and that the account accepted the tester invitation.`,
    };
  }

  const credentials = encryptCredentials({
    igUserId: parsed.data.igUserId,
    accessToken,
    pageId: parsed.data.pageId,
  });

  await prisma.channelAccount.upsert({
    where: {
      personaId_platform_externalId: {
        personaId: persona.id,
        platform: Platform.INSTAGRAM,
        externalId: parsed.data.igUserId,
      },
    },
    create: {
      personaId: persona.id,
      platform: Platform.INSTAGRAM,
      externalId: parsed.data.igUserId,
      credentials,
      maxRating: Rating.SFW,
      tokenExpiresAt,
    },
    update: { credentials, tokenExpiresAt },
  });

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}


/**
 * Supprime un ChannelAccount (7.4: réservé à `owner`).
 *
 * Pour Telegram, la ligne en base ne suffit pas: le worker détient une session
 * ouverte et une base chiffrée sur disque. Elles sont fermées et effacées
 * **avant** la suppression, sinon le prochain démarrage rouvrirait une persona
 * qu'on croit supprimée, et une reconnexion retomberait sur l'ancien compte.
 *
 * `removeApiKeys` efface en plus le couple api_id / api_hash de la persona,
 * pour repartir vraiment de zéro.
 */
export async function deleteChannelAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOwner();
  const channelAccountId = String(formData.get("channelAccountId") ?? "");
  const removeApiKeys = formData.get("removeApiKeys") === "on";
  if (!channelAccountId) return { ok: false, error: "Channel not found." };

  const channel = await prisma.channelAccount.findFirst({
    // Scope serveur: l'organisation vient de la session (9.6).
    where: { id: channelAccountId, persona: { organizationId: ctx.organizationId } },
    select: { id: true, platform: true, personaId: true },
  });
  if (!channel) return { ok: false, error: "Channel not found." };

  if (channel.platform === Platform.TELEGRAM) {
    try {
      await disconnectTelegramSession(channel.personaId);
    } catch (error) {
      return {
        ok: false,
        error: `Session not released by the Telegram worker: ${(error as Error).message}`,
      };
    }
  }

  await prisma.channelAccount.delete({ where: { id: channel.id } });

  if (removeApiKeys && channel.platform === Platform.TELEGRAM) {
    await prisma.telegramApp
      .delete({ where: { personaId: channel.personaId } })
      .catch(() => {
        // Absentes: rien à signaler, le résultat voulu est atteint.
      });
  }

  revalidatePath("/settings");
  return { ok: true };
}
