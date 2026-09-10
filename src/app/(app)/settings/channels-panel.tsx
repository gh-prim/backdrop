"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlatformLogo } from "@/components/platform-logo";
import { cn } from "cn";
import type { PersonaOption } from "@/lib/persona";
import { InstagramWizard } from "./instagram-wizard";
import { TelegramWizard } from "./telegram-wizard";

type Platform = "INSTAGRAM" | "TELEGRAM" | "FANVUE";

export type ChannelTile = {
  id: string;
  personaId: string;
  platform: Platform;
  maxRating: string;
  state: string;
  expiresInDays: number | null;
};

const CATALOG: {
  platform: Platform;
  name: string;
  blurb: string;
  available: boolean;
}[] = [
  {
    platform: "INSTAGRAM",
    name: "Instagram",
    blurb: "Posts, carousels and Reels through the Graph API.",
    available: true,
  },
  {
    platform: "TELEGRAM",
    name: "Telegram",
    blurb: "User session over MTProto. One api_id per persona.",
    available: true,
  },
  {
    platform: "FANVUE",
    name: "Fanvue",
    blurb: "Lands in phase 4.",
    available: false,
  },
];

/**
 * Canaux connectés, en tuiles, et connexion en modal.
 *
 * Chaque plateforme a son propre parcours — Instagram échange un token,
 * Telegram négocie une session par code — et rien ne gagnait à les faire tenir
 * dans un formulaire commun. Le modal isole ce parcours: on choisit d'abord la
 * plateforme, puis on suit le wizard qui lui correspond.
 */
export function ChannelsPanel({
  channels,
  personas,
  personaNames,
  telegramPersonaIds,
  isOwner,
}: {
  channels: ChannelTile[];
  personas: PersonaOption[];
  personaNames: Record<string, string>;
  telegramPersonaIds: string[];
  isOwner: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [connecting, setConnecting] = useState<Platform | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {channels.length === 0
            ? "No channel connected."
            : `${channels.length} channel${channels.length > 1 ? "s" : ""} connected.`}
        </p>
        {isOwner && (
          <Button
            type="button"
            size="sm"
            className="ml-auto h-8"
            onClick={() => setPicking(true)}
          >
            <PlusIcon />
            Add channel
          </Button>
        )}
      </div>

      {/* La grille est la seule zone qui peut défiler: c'est une liste, et la
          règle du non-scroll vise les pages de détail, pas les collections. */}
      <div className="grid min-h-0 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
        {channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            personaName={personaNames[channel.personaId] ?? "unknown persona"}
          />
        ))}

        {channels.length === 0 && (
          <p className="col-span-full rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            {isOwner
              ? "Add a channel to start publishing."
              : "Only an owner can connect a channel."}
          </p>
        )}
      </div>

      {!isOwner && (
        <p className="text-xs text-muted-foreground">
          Credentials are never shown, whatever the role. This screen shows a connection state
          and nothing else.
        </p>
      )}

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Which channel do you want to add?</DialogTitle>
            <DialogDescription>
              Each platform has its own connection flow.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 sm:grid-cols-3">
            {CATALOG.map((entry) => (
              <button
                key={entry.platform}
                type="button"
                disabled={!entry.available}
                onClick={() => {
                  setPicking(false);
                  setConnecting(entry.platform);
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors",
                  entry.available
                    ? "hover:border-foreground/30 hover:bg-muted/50"
                    : "cursor-default opacity-45",
                )}
              >
                <PlatformLogo platform={entry.platform} className="size-8" />
                <span className="text-sm font-medium">{entry.name}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {entry.blurb}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={connecting !== null}
        onOpenChange={(open) => !open && setConnecting(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {connecting && <PlatformLogo platform={connecting} className="size-5" />}
              Connect {connecting === "TELEGRAM" ? "Telegram" : "Instagram"}
            </DialogTitle>
          </DialogHeader>

          {connecting === "INSTAGRAM" && (
            <InstagramWizard personas={personas} onDone={() => setConnecting(null)} />
          )}
          {connecting === "TELEGRAM" && (
            <TelegramWizard
              personas={personas}
              configuredPersonaIds={telegramPersonaIds}
              onDone={() => setConnecting(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChannelCard({
  channel,
  personaName,
}: {
  channel: ChannelTile;
  personaName: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <PlatformLogo platform={channel.platform} className="size-8 shrink-0" />

      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">{personaName}</p>
        <p className="text-xs text-muted-foreground">
          {channel.platform.charAt(0) + channel.platform.slice(1).toLowerCase()}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <StateBadge state={channel.state} expiresInDays={channel.expiresInDays} />
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            max {channel.maxRating}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function StateBadge({
  state,
  expiresInDays,
}: {
  state: string;
  expiresInDays: number | null;
}) {
  // Un canal expiré ou proche de l'être doit se voir immédiatement: c'est la
  // panne qui ne casse rien tant qu'aucune publication n'est due.
  if (state === "expired") {
    return (
      <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
        expired
      </Badge>
    );
  }
  if (state === "expiring") {
    return (
      <Badge className="h-5 bg-amber-500/15 px-1.5 text-[10px] text-amber-700 dark:text-amber-400">
        reconnect within {expiresInDays} d
      </Badge>
    );
  }
  if (state === "connected") {
    return (
      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
        connected{expiresInDays !== null ? ` · ${expiresInDays} d` : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
      unknown state
    </Badge>
  );
}
