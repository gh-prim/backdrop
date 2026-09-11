import "server-only";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OrgContext } from "@/lib/session";

/**
 * Lecture de l'inbox côté web.
 *
 * Un seul invariant, mais il ne souffre aucune exception: **toute** requête
 * remonte jusqu'à `persona.organizationId`. Un fil de discussion contient des
 * messages privés — c'est le contenu le plus sensible de l'outil, et une
 * fuite inter-organisation y serait pire que partout ailleurs (9.6).
 *
 * L'écriture, elle, n'est pas ici: elle passe par le worker Telegram, qui est
 * le seul à tenir la session TDLib.
 */

/** Ce qu'une liste de conversations a besoin de montrer, et rien de plus. */
export async function listConversations(
  ctx: OrgContext,
  personaId?: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
) {
  return prisma.conversation.findMany({
    where: {
      channelAccount: {
        persona: {
          organizationId: ctx.organizationId,
          ...(personaId ? { id: personaId } : {}),
        },
      },
      ...(includeArchived ? {} : { archived: false }),
    },
    select: {
      id: true,
      title: true,
      unreadCount: true,
      lastMessageAt: true,
      archived: true,
      channelAccount: { select: { id: true, platform: true, personaId: true } },
      contact: {
        select: { id: true, displayName: true, username: true, externalId: true },
      },
      // Le dernier message sert d'aperçu dans la liste: une requête, pas N.
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: {
          text: true,
          direction: true,
          sentAt: true,
          attachments: { select: { kind: true }, take: 1 },
        },
      },
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}

/**
 * Un fil, du plus ancien au plus récent.
 *
 * `take` compté depuis la fin: on veut les derniers messages, affichés dans
 * l'ordre de lecture. Remonter plus haut viendra avec la pagination.
 */
export async function getConversation(
  ctx: OrgContext,
  conversationId: string,
  { take = 100 }: { take?: number } = {},
) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      channelAccount: { persona: { organizationId: ctx.organizationId } },
    },
    select: {
      id: true,
      title: true,
      externalId: true,
      unreadCount: true,
      archived: true,
      channelAccount: {
        select: { id: true, platform: true, personaId: true },
      },
      contact: {
        select: {
          id: true,
          displayName: true,
          username: true,
          externalId: true,
          avatarPath: true,
        },
      },
    },
  });
  if (!conversation) return null;

  const messages = await prisma.message.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: { sentAt: "desc" },
    take,
    select: {
      id: true,
      externalId: true,
      direction: true,
      status: true,
      text: true,
      sentAt: true,
      editedAt: true,
      failReason: true,
      author: { select: { id: true, displayName: true, username: true } },
      sentBy: { select: { id: true, name: true } },
      replyTo: {
        select: {
          id: true,
          text: true,
          direction: true,
          author: { select: { displayName: true, username: true } },
        },
      },
      attachments: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          kind: true,
          localPath: true,
          thumbPath: true,
          variantId: true,
          width: true,
          height: true,
          durationSeconds: true,
          sizeBytes: true,
        },
      },
      reactions: {
        select: {
          id: true,
          emoji: true,
          byUs: true,
          contact: { select: { displayName: true, username: true } },
        },
      },
    },
  });

  return { ...conversation, messages: messages.reverse() };
}

/** Le badge de la barre: un seul nombre, une seule requête. */
export async function countUnread(
  ctx: OrgContext,
  personaId?: string,
): Promise<number> {
  const rows = await prisma.conversation.aggregate({
    where: {
      archived: false,
      channelAccount: {
        persona: {
          organizationId: ctx.organizationId,
          ...(personaId ? { id: personaId } : {}),
        },
      },
    },
    _sum: { unreadCount: true },
  });
  return rows._sum.unreadCount ?? 0;
}

/**
 * Le compte Telegram d'une persona, s'il est connecté.
 *
 * Écrire dans un fil suppose une session ouverte: sans ce compte, l'écran doit
 * le dire au lieu de laisser croire qu'un message est parti.
 */
export async function telegramAccountFor(
  ctx: OrgContext,
  personaId: string,
): Promise<{ id: string } | null> {
  return prisma.channelAccount.findFirst({
    where: {
      personaId,
      platform: Platform.TELEGRAM,
      persona: { organizationId: ctx.organizationId },
    },
    select: { id: true },
  });
}
