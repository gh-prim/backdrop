import { requireOrgContext } from "@/lib/session";
import { getSelectedPersonaId, listPersonas } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listConversations, getConversation } from "@/lib/inbox";
import { InboxShell } from "./inbox-shell";

/**
 * L'inbox unifiée — Telegram pour commencer (spec 1, rouverte le 2026-09-11).
 *
 * Le fil sélectionné est rendu côté serveur, pas chargé après coup: ouvrir une
 * conversation est l'action la plus fréquente de cet écran, et la faire
 * attendre un aller-retour se sent immédiatement.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const personaId = selectedId === ALL_PERSONAS ? undefined : selectedId;

  const conversations = await listConversations(ctx, personaId);
  // Un identifiant de fil forgé ne donne rien: `getConversation` remonte
  // jusqu'à l'organisation de la session (9.6).
  const active = c ? await getConversation(ctx, c) : null;

  return (
    <InboxShell
      conversations={conversations.map((conversation) => ({
        id: conversation.id,
        title:
          conversation.title ??
          conversation.contact?.displayName ??
          conversation.contact?.username ??
          "Unnamed chat",
        platform: conversation.channelAccount.platform,
        unreadCount: conversation.unreadCount,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        preview: previewOf(conversation.messages[0]),
      }))}
      activeId={active?.id ?? null}
      thread={
        active && {
          id: active.id,
          title:
            active.title ??
            active.contact?.displayName ??
            active.contact?.username ??
            `Chat ${active.externalId}`,
          username: active.contact?.username ?? null,
          messages: active.messages.map((message) => ({
            id: message.id,
            direction: message.direction,
            status: message.status,
            text: message.text,
            sentAt: message.sentAt.toISOString(),
            editedAt: message.editedAt?.toISOString() ?? null,
            failReason: message.failReason,
            authorName: message.author?.displayName ?? message.author?.username ?? null,
            sentByName: message.sentBy?.name ?? null,
            replyTo: message.replyTo && {
              id: message.replyTo.id,
              text: message.replyTo.text,
              direction: message.replyTo.direction,
            },
            attachments: message.attachments.map((attachment) => ({
              id: attachment.id,
              kind: attachment.kind,
              hasFile: Boolean(attachment.localPath),
              variantId: attachment.variantId,
            })),
            reactions: message.reactions.map((reaction) => ({
              id: reaction.id,
              emoji: reaction.emoji,
              byUs: reaction.byUs,
            })),
          })),
        }
      }
    />
  );
}

/** L'aperçu d'une liste: un texte, ou à défaut la nature de la pièce jointe. */
function previewOf(
  message:
    | { text: string; direction: string; attachments: { kind: string }[] }
    | undefined,
): string {
  if (!message) return "";
  if (message.text) return message.text;
  const kind = message.attachments[0]?.kind;
  return kind ? kind.toLowerCase() : "";
}
