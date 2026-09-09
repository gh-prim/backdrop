"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Platform, Rating } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { encryptCredentials } from "@/lib/crypto";

const schema = z.object({
  personaId: z.string().min(1),
  igUserId: z.string().min(1, "ig_user_id requis."),
  accessToken: z.string().min(20, "Token trop court."),
  pageId: z.string().optional(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Connexion d'un compte Instagram (7.4: réservé à `owner`).
 *
 * Le token est chiffré immédiatement et n'est jamais relu vers le client.
 * `maxRating` est forcé à SFW pour Instagram et n'est pas modifiable via l'UI
 * (spec 8): c'est une propriété du canal, pas un réglage.
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
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  const persona = await prisma.persona.findFirst({
    where: { id: parsed.data.personaId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!persona) return { ok: false, error: "Persona introuvable." };

  const credentials = encryptCredentials({
    igUserId: parsed.data.igUserId,
    accessToken: parsed.data.accessToken,
    pageId: parsed.data.pageId,
  });

  // Le long-lived token vaut 60 jours (4.1.9). La date est indicative jusqu'au
  // premier passage de refreshMetaTokens, qui la remplacera par celle de Meta.
  const tokenExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

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

  revalidatePath("/reglages");
  revalidatePath("/");
  return { ok: true };
}
