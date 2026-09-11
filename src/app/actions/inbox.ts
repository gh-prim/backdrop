"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MessageDirection, MessageStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireOrgContext } from "@/lib/session";
import { startSendTelegramMessage } from "@/temporal/client";

export type ActionResult = { ok: true } | { ok: false; error: string };

const sendSchema = z.object({
  conversationId: z.string().min(1),
  // Telegram plafonne un message texte à 4096 caractères; au-delà il le
  // refuse, et le dire ici évite un aller-retour jusqu'au worker.
  text: z.string().trim().min(1, "Write something first.").max(4096),
  replyToId: z.string().optional(),
});

/**
 * Envoie un message, et l'affiche avant qu'il ne parte.
 *
 * La ligne est écrite en `PENDING` **avant** de démarrer le workflow: taper
 * puis attendre une seconde que le message apparaisse donne l'impression que
 * l'outil a raté le clic. Le worker la passera en `SENT` ou en `FAILED`.
 *
 * `idempotencyKey` sert de clé au workflow: relancer après un incident ne
 * doit pas écrire deux fois chez le destinataire.
 */
export async function sendMessageAction(
  conversationId: string,
  text: string,
  replyToId?: string,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  const parsed = sendSchema.safeParse({ conversationId, text, replyToId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid message." };
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: parsed.data.conversationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: { id: true, channelAccount: { select: { platform: true } } },
  });
  if (!conversation) return { ok: false, error: "Conversation not found." };
  if (conversation.channelAccount.platform !== "TELEGRAM") {
    return { ok: false, error: "Only Telegram can send from here for now." };
  }

  // Répondre à un message d'un autre fil rattacherait deux conversations.
  if (parsed.data.replyToId) {
    const target = await prisma.message.findFirst({
      where: { id: parsed.data.replyToId, conversationId: conversation.id },
      select: { id: true },
    });
    if (!target) return { ok: false, error: "That message is not in this conversation." };
  }

  const idempotencyKey = randomUUID();
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUT,
      status: MessageStatus.PENDING,
      text: parsed.data.text,
      replyToId: parsed.data.replyToId ?? null,
      sentByUserId: ctx.userId,
      idempotencyKey,
    },
    select: { id: true },
  });

  try {
    await startSendTelegramMessage({ messageId: message.id, idempotencyKey });
  } catch {
    // Le détail interne ne sort pas vers le navigateur (9.7). La ligne, elle,
    // est marquée: l'écran montrera l'échec là où l'opérateur regarde.
    await prisma.message.update({
      where: { id: message.id },
      data: { status: MessageStatus.FAILED, failReason: "Could not start the send." },
    });
    return { ok: false, error: "The message could not be queued. Try again." };
  }

  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * Marque un fil comme lu.
 *
 * Ne touche que le compteur local pour l'instant: le dire à Telegram demande
 * une activité côté worker, et laisser le téléphone de la persona porter un
 * badge éternel serait le vrai défaut. À faire suivre.
 */
export async function markReadAction(conversationId: string): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  const updated = await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    data: { unreadCount: 0 },
  });
  if (updated.count === 0) return { ok: false, error: "Conversation not found." };

  revalidatePath("/inbox");
  revalidatePath("/");
  return { ok: true };
}
