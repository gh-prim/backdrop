"use client";

import { useMemo, useState } from "react";
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
 * Le teaser peut venir du lot vendu ou d'ailleurs. Montrer l'une des photos du
 * post est un usage courant — on donne à voir ce qu'on vend — mais ce n'est pas
 * anodin: cette photo-là ne se vend plus. Le panneau le dit au moment du choix
 * plutôt que de l'interdire.
 */
export function FanvuePanel({
  audience,
  onAudienceChange,
  priceUsd,
  onPriceChange,
  previewVariantId,
  onPreviewChange,
  teaserCandidates,
  sentVariantIds,
}: {
  audience: string;
  onAudienceChange: (value: string) => void;
  /** Saisi en dollars: c'est l'unité de la plateforme côté opérateur. */
  priceUsd: string;
  onPriceChange: (value: string) => void;
  previewVariantId: string | null;
  onPreviewChange: (variantId: string | null) => void;
  /** Toute la bibliothèque de la persona: le teaser peut venir d'où l'on veut. */
  teaserCandidates: { id: string; rating: string; ratio: string }[];
  /** Médias vendus par ce post: choisir l'un d'eux le rend gratuit. */
  sentVariantIds: string[];
}) {
  /**
   * Cadrage du teaser.
   *
   * Fanvue affiche en portrait haut: un 4:5 y est rogné et rend mal. Le
   * choix doit donc être explicite, et l'aperçu montrer le vrai cadrage —
   * une vignette forcée dans une boîte 4:5 les fait tous se ressembler.
   */
  const ratios = useMemo(
    () => [...new Set(teaserCandidates.map((variant) => variant.ratio))].sort(),
    [teaserCandidates],
  );
  const [ratioFilter, setRatioFilter] = useState<string>("9:16");

  const shown = useMemo(
    () =>
      ratioFilter === "all"
        ? teaserCandidates
        : teaserCandidates.filter((variant) => variant.ratio === ratioFilter),
    [teaserCandidates, ratioFilter],
  );

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
            Shown to everyone before unlocking. Pick one of the media of this
            send, or any other from the library.
          </p>

          {ratios.length > 1 && (
            <div className="flex gap-1 rounded-md border p-0.5 text-xs">
              {["all", ...ratios].map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setRatioFilter(ratio)}
                  className={cn(
                    "rounded px-2 py-1 transition-colors",
                    ratioFilter === ratio
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {ratio === "all" ? "All ratios" : ratio}
                </button>
              ))}
            </div>
          )}

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

            {shown.slice(0, 12).map((variant) => (
              <button
                key={variant.id}
                type="button"
                title={variant.ratio}
                onClick={() => onPreviewChange(variant.id)}
                className={cn(
                  "relative rounded-md ring-offset-2 ring-offset-background transition",
                  previewVariantId === variant.id && "ring-2 ring-primary",
                )}
              >
                <MediaThumb
                  variantId={variant.id}
                  rating={variant.rating as "SFW" | "SUGGESTIVE" | "NSFW"}
                  ratio={variant.ratio}
                  // Hauteur fixe, largeur au cadrage réel: un 9:16 doit se
                  // reconnaître d'un coup d'œil parmi des 4:5.
                  className={cn(
                    "h-24",
                    variant.ratio === "9:16"
                      ? "w-[54px]"
                      : variant.ratio === "1:1"
                        ? "w-24"
                        : "w-[77px]",
                  )}
                />
                <span className="absolute bottom-1 left-1 rounded bg-background/80 px-1 text-[9px]">
                  {variant.ratio}
                </span>
                {sentVariantIds.includes(variant.id) && (
                  <span className="absolute right-1 top-1 rounded bg-background/80 px-1 text-[9px]">
                    in the post
                  </span>
                )}
              </button>
            ))}

            {shown.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No {ratioFilter} media in this persona's library.
              </p>
            )}
          </div>
          {previewVariantId && sentVariantIds.includes(previewVariantId) && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              This photo is part of the post: it will be visible for free, and
              buyers pay for the {sentVariantIds.length - 1} others.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
