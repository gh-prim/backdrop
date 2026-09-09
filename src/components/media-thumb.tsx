"use client";

import { useState, useSyncExternalStore } from "react";
import { EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";

const BLUR_PREFERENCE_KEY = "backdrop.blur";

/**
 * Préférence de flou, partagée entre toutes les vignettes de la page.
 *
 * `useSyncExternalStore` plutôt qu'un effet: la valeur vit dans localStorage,
 * qui est exactement le genre de source externe pour lequel ce hook existe.
 * Bénéfice concret: basculer la préférence met à jour toutes les vignettes
 * sans recharger la page.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function blurDisabledSnapshot() {
  return localStorage.getItem(BLUR_PREFERENCE_KEY) === "off";
}

/** Côté serveur, on floute: c'est le défaut sûr. */
function serverSnapshot() {
  return false;
}

function setBlurDisabled(value: boolean) {
  localStorage.setItem(BLUR_PREFERENCE_KEY, value ? "off" : "on");
  for (const listener of listeners) listener();
}

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
  const blurDisabled = useSyncExternalStore(
    subscribe,
    blurDisabledSnapshot,
    serverSnapshot,
  );

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
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            // Reveal n'est pas sélectionner: la vignette peut être imbriquée
            // dans un contrôle de sélection (Composer), qui ne doit pas
            // recevoir ce clic.
            event.stopPropagation();
            setRevealed(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              setRevealed(true);
            }
          }}
          className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1 bg-background/40 text-xs text-foreground"
        >
          <EyeOff className="size-4" />
          Reveal
        </span>
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
  const blurDisabled = useSyncExternalStore(
    subscribe,
    blurDisabledSnapshot,
    serverSnapshot,
  );

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={!blurDisabled}
        onChange={(event) => setBlurDisabled(!event.target.checked)}
      />
      Blur sensitive media
    </label>
  );
}
