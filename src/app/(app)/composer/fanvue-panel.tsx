"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { MediaThumb } from "@/components/media-thumb";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";

/** Plancher d'un contenu payant, en cents (4.3.7). Doublé côté serveur. */
const MIN_PRICE_CENTS = 300;

const AUDIENCES = [
  {
    value: "subscribers",
    label: "Subscribers",
    hint: "Only paying subscribers see the post.",
  },
  {
    value: "followers-and-subscribers",
    label: "Followers and subscribers",
    hint: "Wider reach, free followers included.",
  },
] as const;

/**
 * Réglages propres à Fanvue.
 *
 * Trois choix, et un seul est obligatoire: l'audience.
 *
 * Le prix vaut pour **le post entier**, pas par image: l'API n'a qu'un champ
 * `price`, et tous les `mediaUuids` sont verrouillés ensemble. Vendre une
 * photo à l'unité, c'est donc un post par photo — ou un lien média, qui est un
 * autre objet.
 *
 * Le teaser est une image **hors de l'envoi**: celles du post sont
 * verrouillées, et désigner l'une d'elles comme aperçu gratuit la donnerait et
 * la vendrait à la fois. On propose donc le reste de la bibliothèque.
 */
export function FanvuePanel({
  audience,
  onAudienceChange,
  priceUsd,
  onPriceChange,
  previewVariantId,
  onPreviewChange,
  teaserCandidates,
}: {
  audience: string;
  onAudienceChange: (value: string) => void;
  /** Saisi en dollars: c'est l'unité de la plateforme côté opérateur. */
  priceUsd: string;
  onPriceChange: (value: string) => void;
  previewVariantId: string | null;
  onPreviewChange: (variantId: string | null) => void;
  /** Médias **hors** de l'envoi: le teaser est ce qu'on montre, pas ce qu'on vend. */
  teaserCandidates: { id: string; rating: string; ratio: string }[];
}) {
  const cents = useMemo(() => {
    const value = Number(priceUsd.replace(",", "."));
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
  }, [priceUsd]);

  const tooCheap = cents > 0 && cents < MIN_PRICE_CENTS;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Audience</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {AUDIENCES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onAudienceChange(option.value)}
              className={cn(
                "rounded-md border p-2.5 text-left transition-colors",
                audience === option.value
                  ? "border-primary bg-accent"
                  : "hover:bg-accent/40",
              )}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fv-price">Price</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            id="fv-price"
            value={priceUsd}
            onChange={(event) => onPriceChange(event.target.value)}
            placeholder="Free post"
            inputMode="decimal"
            className="h-8 w-32"
          />
          {cents > 0 && (
            <span className="text-xs text-muted-foreground">{cents} cents</span>
          )}
        </div>
        {tooCheap ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Fanvue refuses a paid post under ${(MIN_PRICE_CENTS / 100).toFixed(2)}.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Leave empty for a free post. A paid post needs media, and its price
            starts at ${(MIN_PRICE_CENTS / 100).toFixed(2)}.
          </p>
        )}
      </div>

      {cents >= MIN_PRICE_CENTS && (
        <div className="space-y-1.5">
          <Label>Free preview</Label>
          <p className="text-xs text-muted-foreground">
            {/* Le teaser est ce que voient les non-abonnés: sans lui, un post
                payant n'est qu'un cadenas. */}
            Shown to everyone before unlocking, and never part of what they
            buy — so it comes from the rest of the library, not from this send.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onPreviewChange(null)}
              className={cn(
                "h-20 w-16 rounded-md border text-[11px] text-muted-foreground transition-colors",
                previewVariantId === null
                  ? "border-primary bg-accent text-foreground"
                  : "hover:bg-accent/40",
              )}
            >
              None
            </button>

            {teaserCandidates.slice(0, 12).map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => onPreviewChange(variant.id)}
                className={cn(
                  "rounded-md ring-offset-2 ring-offset-background transition",
                  previewVariantId === variant.id && "ring-2 ring-primary",
                )}
              >
                <MediaThumb
                  variantId={variant.id}
                  rating={variant.rating as "SFW" | "SUGGESTIVE" | "NSFW"}
                  ratio={variant.ratio}
                  className="h-20 w-16"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
