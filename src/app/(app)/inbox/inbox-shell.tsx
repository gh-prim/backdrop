"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CornerUpLeft, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendMessageAction, markReadAction } from "@/app/actions/inbox";
import { PlatformLogo } from "@/components/platform-logo";
import { unreadLabel } from "@/lib/unread-shared";
import { cn } from "cn";

/** Au-delà, ce n'est plus un envoi lent: c'est un worker à l'arrêt. */
const PENDING_EVERY_MS = 1_200;
const PENDING_POLLS = 40;

type Conversation = {
  id: string;
  title: string;
  platform: "INSTAGRAM" | "TELEGRAM" | "FANVUE";
  unreadCount: number;
  lastMessageAt: string | null;
  preview: string;
};

type Message = {
  id: string;
  direction: "IN" | "OUT";
  status: "PENDING" | "SENT" | "FAILED";
  text: string;
  sentAt: string;
  editedAt: string | null;
  failReason: string | null;
  authorName: string | null;
  sentByName: string | null;
  replyTo: { id: string; text: string; direction: string } | null;
  attachments: { id: string; kind: string; hasFile: boolean; variantId: string | null }[];
  reactions: { id: string; emoji: string; byUs: boolean }[];
};

type Thread = {
  id: string;
  title: string;
  username: string | null;
  messages: Message[];
};

/**
 * Deux colonnes, et une seule qui défile.
 *
 * La liste des fils est une liste: le défilement y est légitime. Le fil
 * lui-même aussi, par nature. Le reste de l'écran, non — c'est la règle de
 * l'outil, et elle tient ici parce que la hauteur est bornée par la fenêtre
 * plutôt que par le contenu.
 */
export function InboxShell({
  conversations,
  activeId,
  thread,
}: {
  conversations: Conversation[];
  activeId: string | null;
  thread: Thread | null;
}) {
  const router = useRouter();
  const bottom = useRef<HTMLDivElement>(null);

  // La cible d'une réponse retient le fil d'où elle vient. Changer de
  // conversation l'abandonne donc **au rendu**, sans effet de remise à zéro:
  // répondre au message d'un autre fil n'a aucun sens, et garder le bandeau
  // afficherait une citation qui ne correspond plus à ce qu'on regarde.
  const [reply, setReply] = useState<{ conversationId: string; message: Message } | null>(
    null,
  );
  const replyTo = reply && reply.conversationId === thread?.id ? reply.message : null;

  /**
   * Suit un envoi jusqu'à ce qu'il soit confirmé.
   *
   * `router.refresh()` au retour de l'action arrive **avant** le worker: le
   * message restait donc affiché « sending… » indéfiniment alors qu'il était
   * parti depuis longtemps. On redemande la page tant qu'une ligne est en
   * attente, et l'on s'arrête dès qu'il n'y en a plus.
   *
   * Borné dans le temps: si le worker est à l'arrêt, mieux vaut un écran figé
   * qu'un onglet qui interroge le serveur jusqu'au soir. L'arrivée des
   * messages entrants, elle, ne passera pas par là mais par le flux
   * d'événements.
   */
  const pending = thread?.messages.some((message) => message.status === "PENDING");
  useEffect(() => {
    if (!pending) return;

    let left = PENDING_POLLS;
    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) clearInterval(timer);
      else router.refresh();
    }, PENDING_EVERY_MS);

    return () => clearInterval(timer);
  }, [pending, router]);

  // Un fil s'ouvre sur son dernier message, comme partout ailleurs.
  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [thread?.id, thread?.messages.length]);

  // Ouvrir un fil, c'est le lire. Le compteur retombe donc à l'ouverture,
  // plutôt qu'à un clic supplémentaire que personne ne ferait.
  const threadId = thread?.id;
  const unread = threadId ? unreadOf(conversations, threadId) : 0;
  useEffect(() => {
    if (!threadId || unread === 0) return;
    void markReadAction(threadId).then(() => router.refresh());
  }, [threadId, unread, router]);

  return (
    // Une seule séparation, verticale, entre les deux colonnes. Encadrer
    // chacune ajoutait quatre traits pour ne rien distinguer de plus.
    <div className="grid h-[calc(100svh-7rem)] grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r">
        <div className="flex shrink-0 items-center justify-between px-3 py-2">
          <h1 className="text-sm font-bold">Inbox</h1>
          <span className="text-[11px] text-muted-foreground">
            {conversations.length} chat{conversations.length > 1 ? "s" : ""}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              No conversation yet. Messages appear here as they arrive.
            </p>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => router.push(`/inbox?c=${conversation.id}`)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left transition",
                  conversation.id === activeId ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <PlatformLogo
                  platform={conversation.platform}
                  className="mt-0.5 size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">
                      {conversation.title}
                    </span>
                    {conversation.unreadCount > 0 && (
                      <span className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                        {unreadLabel(conversation.unreadCount)}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {conversation.preview || "—"}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        {!thread ? (
          <p className="m-auto text-xs text-muted-foreground">
            Pick a conversation on the left.
          </p>
        ) : (
          <>
            <div className="shrink-0 px-4 py-3">
              <h2 className="text-sm font-bold">{thread.title}</h2>
              {thread.username && (
                <p className="text-[11px] text-muted-foreground">@{thread.username}</p>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {thread.messages.map((message) => (
                <Bubble
                  key={message.id}
                  message={message}
                  onReply={() =>
                    setReply({ conversationId: thread.id, message })
                  }
                />
              ))}
              <div ref={bottom} />
            </div>

            <Composer
              conversationId={thread.id}
              replyTo={replyTo}
              onClearReply={() => setReply(null)}
            />
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Le champ de saisie.
 *
 * Entrée envoie, Maj+Entrée passe à la ligne: c'est la convention de toutes
 * les messageries, et l'inverser ferait envoyer des brouillons. Le champ se
 * vide au clic sans attendre la confirmation — la ligne est déjà écrite côté
 * serveur, l'écran la montre en « sending… ».
 */
function Composer({
  conversationId,
  replyTo,
  onClearReply,
}: {
  conversationId: string;
  replyTo: Message | null;
  onClearReply: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function send() {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    startTransition(async () => {
      setError(null);
      const result = await sendMessageAction(conversationId, trimmed, replyTo?.id);
      if (result.ok) {
        setText("");
        onClearReply();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="shrink-0 space-y-1.5 px-4 py-3">
      {replyTo && (
        <div className="flex items-center gap-2 rounded border-l-2 border-primary/50 bg-muted/50 px-2 py-1">
          <CornerUpLeft className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {replyTo.text || "media"}
          </span>
          <button
            type="button"
            onClick={onClearReply}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Cancel reply"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={text}
          disabled={pending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={replyTo ? "Reply…" : "Write a message…"}
          className="max-h-32 flex-1 resize-none rounded-md bg-muted px-3 py-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        />
        <Button
          type="button"
          size="icon-sm"
          onClick={send}
          disabled={pending || text.trim().length === 0}
          aria-label="Send"
        >
          <Send className="size-3.5" />
        </Button>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

/** Le compteur d'un fil, tel que la liste le connaît. */
function unreadOf(conversations: Conversation[], id: string): number {
  return conversations.find((conversation) => conversation.id === id)?.unreadCount ?? 0;
}

function Bubble({
  message,
  onReply,
}: {
  message: Message;
  onReply: () => void;
}) {
  const outgoing = message.direction === "OUT";

  return (
    <div className={cn("group flex items-center gap-1.5", outgoing ? "justify-end" : "justify-start")}>
      {outgoing && <ReplyButton onReply={onReply} />}
      <div className="max-w-[70%] space-y-1">
        {message.replyTo && (
          // Le message auquel on répond, montré en entier mais discret: sans
          // lui, une réponse courte n'a plus de sens une heure plus tard.
          <div className="rounded border-l-2 border-primary/50 bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
            {message.replyTo.text || "media"}
          </div>
        )}

        <div
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs",
            outgoing ? "bg-primary text-primary-foreground" : "bg-muted",
            message.status === "FAILED" && "ring-1 ring-destructive",
          )}
        >
          {message.attachments.length > 0 && (
            <p className="mb-1 flex items-center gap-1 text-[11px] opacity-80">
              <Paperclip className="size-3" />
              {message.attachments.map((attachment) => attachment.kind.toLowerCase()).join(", ")}
            </p>
          )}
          {message.text || <span className="opacity-60">no text</span>}
        </div>

        <div className="flex items-center gap-1.5 px-1">
          <span className="text-[10px] text-muted-foreground">
            {new Date(message.sentAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {message.editedAt && (
            <span className="text-[10px] text-muted-foreground">edited</span>
          )}
          {message.status === "PENDING" && (
            <span className="text-[10px] text-muted-foreground">sending…</span>
          )}
          {message.status === "FAILED" && (
            <span className="text-[10px] text-destructive">
              {message.failReason ?? "failed"}
            </span>
          )}
          {/* Qui a répondu. Vous êtes plusieurs sur la même persona: sans ce
              nom, on ne sait pas si quelqu'un s'en est déjà chargé. */}
          {outgoing && message.sentByName && (
            <span className="text-[10px] text-muted-foreground">
              {message.sentByName}
            </span>
          )}

          {message.reactions.map((reaction) => (
            <span
              key={reaction.id}
              className={cn(
                "rounded-full px-1 text-[10px]",
                reaction.byUs ? "bg-primary/20" : "bg-muted",
              )}
            >
              {reaction.emoji}
            </span>
          ))}
        </div>
      </div>
      {!outgoing && <ReplyButton onReply={onReply} />}
    </div>
  );
}

/**
 * Répondre à **ce** message.
 *
 * Visible au survol seulement: un bouton par message, affiché en permanence,
 * transformerait le fil en grille de contrôles.
 */
function ReplyButton({ onReply }: { onReply: () => void }) {
  return (
    <button
      type="button"
      onClick={onReply}
      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      aria-label="Reply to this message"
    >
      <CornerUpLeft className="size-3.5" />
    </button>
  );
}
