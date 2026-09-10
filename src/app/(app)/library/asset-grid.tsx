"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CloudUpload, Loader2, Search, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MediaThumb } from "@/components/media-thumb";
import { useLocalPreference } from "@/lib/use-local-preference";
import { cn } from "cn";
import { AlbumBar, type AlbumOption } from "./album-bar";

type Rating = "SFW" | "SUGGESTIVE" | "NSFW";

export type AssetCard = {
  id: string;
  rating: Rating;
  personaId: string;
  personaName: string;
  authorName: string;
  createdAt: string;
  isVideo: boolean;
  description: string | null;
  usageCount: number;
  variants: { id: string; ratio: string; onR2: boolean }[];
};

const RATING_FILTERS = ["All", "SFW", "SUGGESTIVE", "NSFW"] as const;
const TYPE_FILTERS = [
  { key: "all", label: "All types" },
  { key: "image", label: "Images" },
  { key: "video", label: "Videos" },
] as const;

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 8;

export function AssetGrid({
  assets,
  albums,
}: {
  assets: AssetCard[];
  albums: AlbumOption[];
}) {
  const [query, setQuery] = useState("");
  const [ratingFilter, setRatingFilter] = useState<string>("All");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [instagramReady, setInstagramReady] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [neverUsed, setNeverUsed] = useState(false);

  // La densité est une préférence d'opérateur, pas un réglage de session:
  // elle survit donc à la navigation et aux rechargements.
  const [columns, setColumns] = useLocalPreference("backdrop.library.columns", 4, (raw) =>
    Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Number(raw) || 4)),
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return assets.filter((asset) => {
      if (ratingFilter !== "All" && asset.rating !== ratingFilter) return false;
      if (typeFilter === "image" && asset.isVideo) return false;
      if (typeFilter === "video" && !asset.isVideo) return false;
      if (neverUsed && asset.usageCount > 0) return false;
      if (instagramReady) {
        if (asset.rating !== "SFW") return false;
        if (!asset.variants.some((variant) => variant.onR2)) return false;
      }
      if (!needle) return true;

      // Recherche sur ce que l'opérateur connaît d'un média: sa note, la
      // persona, qui l'a ajouté, et les ratios disponibles.
      return [
        asset.description ?? "",
        asset.personaName,
        asset.authorName,
        ...asset.variants.map((variant) => variant.ratio),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [assets, query, ratingFilter, typeFilter, instagramReady, neverUsed]);

  /** Personas représentées dans la sélection courante. */
  const pickedPersonas = useMemo(() => {
    const byId = new Map(assets.map((asset) => [asset.id, asset.personaId]));
    return [...new Set(picked.map((id) => byId.get(id)).filter(Boolean))] as string[];
  }, [assets, picked]);

  const activeFilters =
    (ratingFilter !== "All" ? 1 : 0) +
    (typeFilter !== "all" ? 1 : 0) +
    (instagramReady ? 1 : 0) +
    (neverUsed ? 1 : 0) +
    (query.trim() ? 1 : 0);

  function reset() {
    setQuery("");
    setRatingFilter("All");
    setTypeFilter("all");
    setInstagramReady(false);
    setNeverUsed(false);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search description, persona, author, ratio"
              className="h-8 pl-8"
            />
          </div>

          {/* Densité d'affichage: de deux miniatures par ligne pour vérifier un
              cadrage, à huit pour balayer une grande bibliothèque (6.1). */}
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            Columns
            <input
              type="range"
              min={MIN_COLUMNS}
              max={MAX_COLUMNS}
              value={columns}
              onChange={(event) => setColumns(Number(event.target.value))}
              className="w-28"
            />
            <span className="w-3 font-medium text-foreground">{columns}</span>
          </label>
        </div>

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

          <div className="flex gap-1 rounded-md border p-0.5 text-xs">
            {TYPE_FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setTypeFilter(option.key)}
                className={cn(
                  "rounded px-2.5 py-1 transition-colors",
                  typeFilter === option.key
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={instagramReady}
              onChange={(event) => setInstagramReady(event.target.checked)}
            />
            Instagram-ready
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={neverUsed}
              onChange={(event) => setNeverUsed(event.target.checked)}
            />
            Never used
          </label>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3" />
              Reset
            </button>
          )}

          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {assets.length}
          </span>
        </div>
      </div>

      <AlbumBar
        selected={picked}
        // Un album appartient à une persona: ne proposer que les siens évite
        // de faire choisir un album que l'action refusera ensuite.
        albums={albums.filter((album) => album.personaId === pickedPersonas[0])}
        mixedPersonas={pickedPersonas.length > 1}
        onClear={() => setPicked([])}
      />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {assets.length === 0
              ? "No assets yet. The Upload button opens the drop zone: variants are derived automatically, and pushed to R2 only when the asset is SFW."
              : "No asset matches these filters."}
          </CardContent>
        </Card>
      ) : (
        <div
          className="grid gap-3"
          // Le nombre de colonnes est dynamique: une classe Tailwind ne peut
          // pas l'exprimer, elle serait purgée à la compilation.
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {filtered.map((asset) => {
            const cover = asset.variants[0];
            const onR2 = asset.variants.filter((variant) => variant.onR2).length;
            const dense = columns >= 6;
            return (
              <Card
                key={asset.id}
                className={cn(
                  "group/asset relative overflow-hidden py-0 transition-colors hover:border-primary/60",
                  picked.includes(asset.id) && "border-primary",
                )}
              >
                {/* Case discrète au repos, révélée au survol ou dès qu'une
                    sélection est en cours: cocher n'est pas le geste courant
                    d'une bibliothèque, ouvrir un média l'est. */}
                <label
                  className={cn(
                    "absolute left-2 top-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md bg-background/85 backdrop-blur-sm transition-opacity",
                    picked.includes(asset.id) || picked.length > 0
                      ? "opacity-100"
                      : "opacity-0 group-hover/asset:opacity-100 focus-within:opacity-100",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${asset.description ?? "media"}`}
                    checked={picked.includes(asset.id)}
                    onChange={() =>
                      setPicked((current) =>
                        current.includes(asset.id)
                          ? current.filter((id) => id !== asset.id)
                          : [...current, asset.id],
                      )
                    }
                  />
                </label>

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
                      {!dense && "Deriving…"}
                    </div>
                  )}
                </Link>

                {/* En forte densité, on n'affiche que l'indispensable: le pied
                    de carte deviendrait plus haut que la vignette. */}
                <CardContent className={cn("space-y-1.5", dense ? "p-2" : "p-3")}>
                  {!dense && (
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
                  )}

                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {!dense && <span className="truncate">{asset.personaName}</span>}
                    {asset.usageCount > 0 && (
                      <span className="flex shrink-0 items-center gap-1">
                        <Send className="size-3" />
                        {asset.usageCount}
                      </span>
                    )}
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <CloudUpload
                        className={cn("size-3", onR2 > 0 ? "text-foreground" : "opacity-40")}
                      />
                      {onR2}/{asset.variants.length}
                    </span>
                  </div>

                  {!dense && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {asset.description || `${asset.authorName} · ${asset.createdAt}`}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
