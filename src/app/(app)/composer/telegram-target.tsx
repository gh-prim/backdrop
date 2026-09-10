"use client";

import { useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import {
  readTelegramTargetsAction,
  type TargetsResult,
} from "@/app/actions/telegram-targets";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { TelegramTarget } from "@/temporal/config";

/**
 * Destination Telegram et prix en Stars.
 *
 * Le prix n'apparaît que si la destination l'accepte. TDLib est catégorique:
 * `inputMessagePaidMedia` ne fonctionne que dans un channel dont
 * `has_paid_media_allowed` est vrai — jamais en conversation privée, jamais
 * dans un groupe (4.2.6). Afficher un champ que Telegram refusera ensuite
 * ferait découvrir la limite après le téléversement des médias.
 */
export function TelegramTargetPicker({
  channelAccountId,
  chatId,
  onChatIdChange,
  starPrice,
  onStarPriceChange,
  mediaCount,
}: {
  channelAccountId: string;
  chatId: string;
  onChatIdChange: (chatId: string, label: string) => void;
  starPrice: string;
  onStarPriceChange: (value: string) => void;
  mediaCount: number;
}) {
  const [result, setResult] = useState<TargetsResult | null>(null);

  useEffect(() => {
    let alive = true;
    setResult(null);
    void readTelegramTargetsAction(channelAccountId).then((next) => {
      if (alive) setResult(next);
    });
    return () => {
      alive = false;
    };
  }, [channelAccountId]);

  if (result === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Reading this account&apos;s chats…
      </p>
    );
  }

  if (!result.ok) {
    return <p className="text-xs text-destructive">{result.error}</p>;
  }

  const selected = result.targets.find((target) => target.chatId === chatId);
  const canCharge = selected?.paidMediaAllowed ?? false;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label htmlFor="tg-target">Send to</Label>
        <select
          id="tg-target"
          value={chatId}
          onChange={(event) => {
            const target = result.targets.find((t) => t.chatId === event.target.value);
            onChatIdChange(event.target.value, target?.title ?? "");
            if (!target?.paidMediaAllowed) onStarPriceChange("");
          }}
          className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="">Choose a channel or a person…</option>
          {result.targets.map((target) => (
            <option key={target.chatId} value={target.chatId}>
              {LABELS[target.kind]} {target.title}
              {target.kind === "channel" && !target.paidMediaAllowed ? " — no stars" : ""}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {selected.kind}
          </Badge>
          {canCharge ? (
            <Badge className="h-5 bg-amber-500/15 px-1.5 text-[10px] text-amber-700 dark:text-amber-400">
              paid media allowed
            </Badge>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {selected.kind === "channel"
                ? "This channel has not enabled paid media on Telegram."
                : "Telegram only allows paid media in channels — this send will be free."}
            </span>
          )}
        </div>
      )}

      {canCharge && (
        <div className="space-y-1.5">
          <Label htmlFor="tg-stars" className="flex items-center gap-1.5">
            <Star className="size-3.5" />
            Price in Stars
          </Label>
          <Input
            id="tg-stars"
            value={starPrice}
            onChange={(event) => onStarPriceChange(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="leave empty to send for free"
            className="h-8 w-56"
          />
          <p className="text-xs text-muted-foreground">
            {mediaCount > 1
              ? `One price for the whole pack of ${mediaCount} media: Telegram unlocks them together.`
              : "Price to unlock this media."}{" "}
            Buyers stay anonymous to a user session, so takings are reconciled by
            time window, not per purchase.
          </p>
        </div>
      )}

      <input type="hidden" name="telegramChatId" value={chatId} />
      <input
        type="hidden"
        name="telegramTargetLabel"
        value={selected?.title ?? ""}
      />
      <input type="hidden" name="starPrice" value={canCharge ? starPrice : ""} />
    </div>
  );
}

const LABELS: Record<TelegramTarget["kind"], string> = {
  channel: "📢",
  group: "👥",
  user: "💬",
};
