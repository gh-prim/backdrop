"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CloudUpload, Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MediaThumb } from "@/components/media-thumb";
import { cn } from "cn";

type Rating = "SFW" | "SUGGESTIVE" | "NSFW";

export type AssetCard = {
  id: string;
  rating: Rating;
  personaName: string;
  authorName: string;
  createdAt: string;
  isVideo: boolean;
  description: string | null;
  /** Nombre de publications qui référencent ce média. */
  usageCount: number;
  variants: { id: string; ratio: string; onR2: boolean }[];
};

/**
 * Filtres de la Library (spec 6.1): par rating, et par canal de destination.
 *
 * « Prêt pour Instagram » n'est pas un synonyme de SFW: il faut aussi que le
 * Variant soit effectivement sur R2, sans quoi Meta n'aura rien à récupérer au
 * moment de la publication (4.1.6). Le filtre dit donc la vérité utile, pas
 * seulement le rating.
 */
const RATING_FILTERS = ["Tous", "SFW", "SUGGESTIVE", "NSFW"] as const;

export function AssetGrid({ assets }: { assets: AssetCard[] }) {
  const [ratingFilter, setRatingFilter] = useState<string>("Tous");
  const [instagramReady, setInstagramReady] = useState(false);

  const filtered = useMemo(
    () =>
      assets.filter((asset) => {
        if (ratingFilter !== "Tous" && asset.rating !== ratingFilter) return false;
        if (instagramReady) {
          return asset.rating === "SFW" && asset.variants.some((v) => v.onR2);
        }
        return true;
      }),
    [assets, ratingFilter, instagramReady],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-md border p-0.5 text-xs">
          {RATING_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRatingFilter(value)}
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                ratingFilter === value
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={instagramReady}
            onChange={(event) => setInstagramReady(event.target.checked)}
          />
          Prêt pour Instagram
        </label>

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} sur {assets.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {assets.length === 0
              ? "Aucun Asset. Déposez un fichier ci-dessus: les Variants sont dérivés automatiquement, et poussés sur R2 uniquement si l'Asset est SFW."
              : "Aucun Asset ne correspond à ces filtres."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filtered.map((asset) => {
            const cover = asset.variants[0];
            const onR2 = asset.variants.filter((v) => v.onR2).length;
            return (
              <Card
                key={asset.id}
                className="overflow-hidden py-0 transition-colors hover:border-primary/60"
              >
                <Link href={`/library/${asset.id}`} className="block">
                {cover ? (
                  <MediaThumb
                    variantId={cover.id}
                    rating={asset.rating}
                    className="aspect-[4/5] rounded-none border-0"
                  />
                ) : (
                  <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 bg-muted/40 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Dérivation en cours
                  </div>
                )}

                </Link>

                <CardContent className="space-y-2 p-3">
                  <div className="flex flex-wrap gap-1">
                    {asset.variants.map((variant) => (
                      <Badge
                        key={variant.id}
                        variant="outline"
                        className="h-4 px-1 text-[9px]"
                      >
                        {variant.ratio}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">{asset.personaName}</span>
                    {asset.usageCount > 0 && (
                      // Savoir qu'un visuel est déjà parti évite de le
                      // republier sur le même compte.
                      <span className="flex shrink-0 items-center gap-1">
                        <Send className="size-3" />
                        {asset.usageCount}
                      </span>
                    )}
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <CloudUpload
                        className={cn(
                          "size-3",
                          onR2 > 0 ? "text-foreground" : "opacity-40",
                        )}
                      />
                      {onR2}/{asset.variants.length}
                    </span>
                  </div>

                  {/* Attribution: qui a introduit ce média dans l'outil (7.4). */}
                  <p className="truncate text-[11px] text-muted-foreground">
                    {asset.authorName} · {asset.createdAt}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
