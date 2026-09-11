"use client";

import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { PlatformLogo } from "@/components/platform-logo";
import { unreadLabel } from "@/lib/unread-shared";
import { cn } from "cn";

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
                <Bubble key={message.id} message={message} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const outgoing = message.direction === "OUT";

  return (
    <div className={cn("flex", outgoing ? "justify-end" : "justify-start")}>
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
    </div>
  );
}
