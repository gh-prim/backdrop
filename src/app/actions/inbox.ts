"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AttachmentKind, MessageDirection, MessageStatus, Rating } from "@prisma/client";

/** L'échelle de classification, du plus permis au moins permis (section 9). */
const RATING_RANK: Record<Rating, number> = {
  [Rating.SFW]: 0,
  [Rating.SUGGESTIVE]: 1,
  [Rating.NSFW]: 2,
};
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

const sendMediaSchema = z.object({
  conversationId: z.string().min(1),
  // Telegram plafonne un album à dix éléments, comme un carrousel.
  variantIds: z.array(z.string().min(1)).min(1, "Pick at least one media.").max(10),
  caption: z.string().max(1024).optional(),
  replyToId: z.string().optional(),
});

/**
 * Les médias disponibles pour ce fil.
 *
 * Chargés à la demande et non avec la page: deux cents variantes sur chaque
 * rendu de l'inbox seraient payées par tout le monde pour un trombone que
 * personne ne clique la plupart du temps.
 */
export async function mediaForConversationAction(conversationId: string): Promise<
  { id: string; ratio: string; rating: Rating; isVideo: boolean; blocked: boolean }[]
> {
  const ctx = await requireOrgContext();

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: { channelAccount: { select: { personaId: true, maxRating: true } } },
  });
  if (!conversation) return [];

  const variants = await prisma.variant.findMany({
    where: { asset: { personaId: conversation.channelAccount.personaId } },
    select: {
      id: true,
      ratio: true,
      localPath: true,
      asset: { select: { rating: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  const ceiling = RATING_RANK[conversation.channelAccount.maxRating];
  return variants.map((variant) => ({
    id: variant.id,
    ratio: variant.ratio,
    rating: variant.asset.rating,
    isVideo: /\.(mp4|mov|m4v)$/i.test(variant.localPath),
    // Montré mais barré plutôt que masqué: « pourquoi cette photo n'est-elle
    // pas là » est une question qu'on se pose longtemps, alors qu'un média
    // grisé répond tout seul.
    blocked: RATING_RANK[variant.asset.rating] > ceiling,
  }));
}

/**
 * Envoie un ou plusieurs médias de la bibliothèque.
 *
 * Le garde-fou de classification s'applique ici comme ailleurs: un compte
 * déclaré SFW ne doit pas laisser partir du NSFW, en conversation privée pas
 * moins qu'en channel. La vérification est refaite côté serveur à partir de la
 * base — la liste envoyée au navigateur ne fait pas foi.
 */
export async function sendMediaAction(
  conversationId: string,
  variantIds: string[],
  caption?: string,
  replyToId?: string,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  const parsed = sendMediaSchema.safeParse({
    conversationId,
    variantIds,
    caption,
    replyToId,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid media." };
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: parsed.data.conversationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: {
      id: true,
      channelAccount: {
        select: { platform: true, personaId: true, maxRating: true },
      },
    },
  });
  if (!conversation) return { ok: false, error: "Conversation not found." };
  if (conversation.channelAccount.platform !== "TELEGRAM") {
    return { ok: false, error: "Only Telegram can send from here for now." };
  }

  const variants = await prisma.variant.findMany({
    where: {
      id: { in: parsed.data.variantIds },
      asset: { personaId: conversation.channelAccount.personaId },
    },
    select: { id: true, localPath: true, asset: { select: { rating: true } } },
  });
  if (variants.length !== parsed.data.variantIds.length) {
    return { ok: false, error: "Some media are not available for this persona." };
  }

  const ceiling = RATING_RANK[conversation.channelAccount.maxRating];
  const refused = variants.filter(
    (variant) => RATING_RANK[variant.asset.rating] > ceiling,
  );
  if (refused.length > 0) {
    return {
      ok: false,
      error: `This account is limited to ${conversation.channelAccount.maxRating}: ${refused.length} media exceed it.`,
    };
  }

  if (parsed.data.replyToId) {
    const target = await prisma.message.findFirst({
      where: { id: parsed.data.replyToId, conversationId: conversation.id },
      select: { id: true },
    });
    if (!target) return { ok: false, error: "That message is not in this conversation." };
  }

  // L'ordre demandé, pas celui de la base: un album part dans l'ordre où
  // l'opérateur a choisi ses médias.
  const ordered = parsed.data.variantIds.map(
    (id) => variants.find((variant) => variant.id === id)!,
  );

  const idempotencyKey = randomUUID();
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUT,
      status: MessageStatus.PENDING,
      text: parsed.data.caption?.trim() ?? "",
      replyToId: parsed.data.replyToId ?? null,
      sentByUserId: ctx.userId,
      idempotencyKey,
      attachments: {
        create: ordered.map((variant, position) => ({
          kind: /\.(mp4|mov|m4v)$/i.test(variant.localPath)
            ? AttachmentKind.VIDEO
            : AttachmentKind.PHOTO,
          variantId: variant.id,
          position,
        })),
      },
    },
    select: { id: true },
  });

  try {
    await startSendTelegramMessage({ messageId: message.id, idempotencyKey });
  } catch {
    await prisma.message.update({
      where: { id: message.id },
      data: { status: MessageStatus.FAILED, failReason: "Could not start the send." },
    });
    return { ok: false, error: "The media could not be queued. Try again." };
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
