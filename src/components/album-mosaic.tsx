"use client";

import { MediaThumb } from "@/components/media-thumb";
import { cn } from "cn";

/**
 * Vignette d'un album: une mosaïque de ses premiers médias.
 *
 * Le rating passé est celui **le plus élevé de l'album**, pas celui de chaque
 * tuile: flouter média par média laisserait un contenu sensible apparaître
 * derrière trois vignettes anodines, et trahirait le sens du flou (6.1).
 */
export function AlbumMosaic({
  variantIds,
  rating,
  className,
}: {
  variantIds: string[];
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  className?: string;
}) {
  if (variantIds.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border bg-muted/40 text-xs text-muted-foreground",
          className,
        )}
      >
        empty
      </div>
    );
  }

  // Un seul média occupe tout le cadre; au-delà, une grille deux par deux.
  // Trois médias laissent le premier prendre toute la colonne de gauche, ce
  // qui vaut mieux qu'un trou.
  const tiles = variantIds.slice(0, 4);
  const single = tiles.length === 1;

  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-md border bg-border",
        single ? "grid-cols-1" : "grid-cols-2",
        className,
      )}
    >
      {tiles.map((variantId, index) => (
        <MediaThumb
          key={variantId}
          variantId={variantId}
          rating={rating}
          className={cn(
            "h-full w-full rounded-none border-0",
            tiles.length === 3 && index === 0 && "row-span-2",
          )}
        />
      ))}
    </div>
  );
}
