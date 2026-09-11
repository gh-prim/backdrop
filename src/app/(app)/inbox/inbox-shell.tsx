"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CornerUpLeft, EyeOff, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  markReadAction,
  mediaForConversationAction,
  sendMediaAction,
  sendMessageAction,
} from "@/app/actions/inbox";
import { PlatformLogo } from "@/components/platform-logo";
import { unreadLabel } from "@/lib/unread-shared";
import { MediaThumb, useBlurDisabled } from "@/components/media-thumb";
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
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<LibraryMedia[]>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function send() {
    const trimmed = text.trim();
    // Un média peut partir sans légende; un message vide, non.
    if ((!trimmed && chosen.length === 0) || pending) return;

    startTransition(async () => {
      setError(null);
      const result =
        chosen.length > 0
          ? await sendMediaAction(
              conversationId,
              chosen.map((media) => media.id),
              trimmed,
              replyTo?.id,
            )
          : await sendMessageAction(conversationId, trimmed, replyTo?.id);

      if (result.ok) {
        setText("");
        setChosen([]);
        onClearReply();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="relative shrink-0 space-y-1.5 px-4 py-3">
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

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((media) => (
            <button
              key={media.id}
              type="button"
              onClick={() =>
                setChosen((previous) => previous.filter((item) => item.id !== media.id))
              }
              className="relative size-12 overflow-hidden rounded border"
              title="Remove"
            >
              <MediaThumb
                variantId={media.id}
                rating={media.rating}
                className="size-full border-0"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-background/60 opacity-0 transition-opacity hover:opacity-100">
                <X className="size-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => setPicking(true)}
          disabled={pending}
          aria-label="Attach media from the library"
        >
          <Paperclip className="size-3.5" />
        </Button>

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
          placeholder={
            chosen.length > 0 ? "Caption (optional)…" : replyTo ? "Reply…" : "Write a message…"
          }
          className="max-h-32 flex-1 resize-none rounded-md bg-muted px-3 py-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        />
        <Button
          type="button"
          size="icon-sm"
          onClick={send}
          disabled={pending || (text.trim().length === 0 && chosen.length === 0)}
          aria-label="Send"
        >
          <Send className="size-3.5" />
        </Button>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {picking && (
        <MediaPicker
          conversationId={conversationId}
          chosen={chosen}
          onToggle={(media) =>
            setChosen((previous) =>
              previous.some((item) => item.id === media.id)
                ? previous.filter((item) => item.id !== media.id)
                : // Telegram plafonne un album à dix, comme un carrousel.
                  previous.length >= 10
                  ? previous
                  : [...previous, media],
            )
          }
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

type LibraryMedia = {
  id: string;
  ratio: string;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  isVideo: boolean;
  blocked: boolean;
};

/**
 * Le choix d'un média dans la bibliothèque.
 *
 * Chargé à l'ouverture et pas avec la page: deux cents vignettes sur chaque
 * rendu de l'inbox seraient payées par tout le monde pour un trombone que
 * personne ne clique la plupart du temps.
 *
 * Les médias trop classés pour ce compte sont **montrés et barrés**, pas
 * masqués: « pourquoi cette photo n'est-elle pas là » est une question qu'on
 * se pose longtemps, alors qu'un média grisé répond tout seul.
 */
function MediaPicker({
  conversationId,
  chosen,
  onToggle,
  onClose,
}: {
  conversationId: string;
  chosen: LibraryMedia[];
  onToggle: (media: LibraryMedia) => void;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<LibraryMedia[] | null>(null);

  useEffect(() => {
    let alive = true;
    void mediaForConversationAction(conversationId).then((result) => {
      if (alive) setMedia(result);
    });
    return () => {
      alive = false;
    };
  }, [conversationId]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 max-h-80 overflow-y-auto border-t bg-background p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">
          Library {chosen.length > 0 && `· ${chosen.length} selected`}
        </span>
        <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={onClose}>
          Done
        </Button>
      </div>

      {media === null ? (
        <p className="text-[11px] text-muted-foreground">Loading…</p>
      ) : media.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No media for this persona yet.
        </p>
      ) : (
        <div className="grid grid-cols-8 gap-1.5">
          {media.map((item) => {
            const selected = chosen.some((entry) => entry.id === item.id);
            return (
              <button
                key={item.id}
                type="button"
                disabled={item.blocked}
                onClick={() => onToggle(item)}
                title={item.blocked ? `${item.rating}: above what this account allows` : undefined}
                className={cn(
                  "relative overflow-hidden rounded transition",
                  item.blocked
                    ? "cursor-not-allowed opacity-35 grayscale"
                    : selected
                      ? "ring-2 ring-primary"
                      : "hover:opacity-80",
                )}
              >
                <MediaThumb
                  variantId={item.id}
                  rating={item.rating}
                  ratio={item.ratio}
                  className="aspect-square border-0"
                />
              </button>
            );
          })}
        </div>
      )}
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
          {message.attachments.map((attachment) => (
            <Attachment
              key={attachment.id}
              attachment={attachment}
              incoming={!outgoing}
            />
          ))}
          {message.text || (
            message.attachments.length === 0 && (
              <span className="opacity-60">no text</span>
            )
          )}
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
 * Une pièce jointe reçue.
 *
 * Floutée par défaut quand elle vient de l'extérieur, et révélée au clic: un
 * média reçu n'a **aucun** classement — personne ne l'a jugé SFW — et vous
 * êtes plusieurs devant l'écran. C'est la même règle que pour les vignettes
 * de la bibliothèque (6.1), appliquée là où elle compte le plus.
 *
 * Tant que le fichier n'est pas rapatrié, on annonce sa nature plutôt que de
 * laisser un cadre vide: le téléchargement suit le message de quelques
 * secondes, et un média trop lourd reste chez Telegram pour de bon.
 */
function Attachment({
  attachment,
  incoming,
}: {
  attachment: Message["attachments"][number];
  incoming: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const blurDisabled = useBlurDisabled();

  // Un média envoyé depuis la bibliothèque n'est pas copié dans le volume
  // d'inbox: il **est** la variante, et se sert par sa route habituelle. Le
  // dupliquer ne ferait que deux fichiers à garder en phase.
  const source = attachment.variantId
    ? `/api/media/${attachment.variantId}`
    : `/api/inbox/media/${attachment.id}`;

  if (!attachment.hasFile && !attachment.variantId) {
    return (
      <p className="mb-1 flex items-center gap-1 text-[11px] opacity-70">
        <Paperclip className="size-3" />
        {attachment.kind.toLowerCase()}
        <span className="opacity-60">· not downloaded</span>
      </p>
    );
  }

  if (attachment.kind === "VIDEO") {
    return (
      <video
        src={source}
        controls
        className="mb-1 max-h-64 w-full rounded"
        preload="metadata"
      />
    );
  }

  if (attachment.kind === "VOICE") {
    return <audio src={source} controls className="mb-1 w-56" />;
  }

  if (attachment.kind === "DOCUMENT") {
    return (
      <a
        href={source}
        target="_blank"
        rel="noreferrer"
        className="mb-1 flex items-center gap-1 text-[11px] underline"
      >
        <Paperclip className="size-3" />
        {attachment.kind.toLowerCase()}
      </a>
    );
  }

  const hidden = incoming && !revealed && !blurDisabled;

  return (
    <button
      type="button"
      onClick={() => (hidden ? setRevealed(true) : window.open(source, "_blank"))}
      className="relative mb-1 block overflow-hidden rounded"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        alt=""
        className={cn("max-h-64 w-auto transition", hidden && "scale-110 blur-xl")}
      />
      {hidden && (
        <span className="absolute inset-0 flex items-center justify-center gap-1 bg-background/40 text-[11px] text-foreground">
          <EyeOff className="size-3" />
          Reveal
        </span>
      )}
    </button>
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
