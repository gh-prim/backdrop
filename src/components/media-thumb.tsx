"use client";

import { useEffect, useState } from "react";
import { EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";

const BLUR_PREFERENCE_KEY = "backdrop.blur";

/**
 * Vignette d'un média (spec 6.1).
 *
 * Les Assets NSFW et SUGGESTIVE sont floutés par défaut, révélés au clic.
 * L'outil est partagé entre plusieurs opérateurs: le flou n'est pas de la
 * pudeur, c'est une protection contre le regard par-dessus l'épaule.
 */
export function MediaThumb({
  variantId,
  rating,
  ratio,
  className,
}: {
  variantId: string;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  ratio?: string;
  className?: string;
}) {
  const sensitive = rating !== "SFW";
  const [revealed, setRevealed] = useState(false);
  const [blurDisabled, setBlurDisabled] = useState(false);

  useEffect(() => {
    setBlurDisabled(localStorage.getItem(BLUR_PREFERENCE_KEY) === "off");
  }, []);

  const hidden = sensitive && !revealed && !blurDisabled;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-md border bg-muted",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/media/${variantId}`}
        alt=""
        className={cn(
          "h-full w-full object-cover transition",
          hidden && "scale-110 blur-xl",
        )}
      />

      {hidden && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/40 text-xs text-foreground"
        >
          <EyeOff className="size-4" />
          Révéler
        </button>
      )}

      <div className="absolute left-1 top-1 flex gap-1">
        {/* Le rating est affiché partout où un média apparaît, sans exception. */}
        <Badge
          variant={rating === "SFW" ? "secondary" : "destructive"}
          className="h-4 px-1 text-[9px]"
        >
          {rating}
        </Badge>
        {ratio && (
          <Badge variant="outline" className="h-4 bg-background/70 px-1 text-[9px]">
            {ratio}
          </Badge>
        )}
      </div>
    </div>
  );
}

/** Bascule de préférence, persistée localement par opérateur. */
export function BlurPreferenceToggle() {
  const [off, setOff] = useState(false);

  useEffect(() => {
    setOff(localStorage.getItem(BLUR_PREFERENCE_KEY) === "off");
  }, []);

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={!off}
        onChange={(event) => {
          const next = !event.target.checked;
          setOff(next);
          localStorage.setItem(BLUR_PREFERENCE_KEY, next ? "off" : "on");
          location.reload();
        }}
      />
      Flouter les médias sensibles
    </label>
  );
}
