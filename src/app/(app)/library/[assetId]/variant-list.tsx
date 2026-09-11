"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { deriveVariantAction } from "@/app/actions/asset-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaThumb } from "@/components/media-thumb";

const ALL_RATIOS = ["4:5", "3:4", "9:16", "1:1"];

/**
 * Où tombe le recadrage, et comment le déplacer.
 *
 * ffmpeg recadre au centre par défaut — ce qui coupe autant en haut qu'en bas
 * et décapite un sujet placé dans le tiers haut. Le curseur déplace la fenêtre
 * du haut vers le bas, et la re-dérivation remplace le fichier.
 */
function CropOffset({
  assetId,
  variant,
  disabled,
  onDone,
}: {
  assetId: string;
  variant: { id: string; ratio: string; cropOffset: number | null };
  disabled: boolean;
  onDone: (message: string) => void;
}) {
  const [offset, setOffset] = useState(variant.cropOffset ?? 50);
  const [pending, startTransition] = useTransition();
  const changed = offset !== (variant.cropOffset ?? 50);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">top</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={offset}
          disabled={disabled || pending}
          onChange={(event) => setOffset(Number(event.target.value))}
          className="h-1 flex-1"
          aria-label={`Vertical crop for ${variant.ratio}`}
        />
        <span className="text-[10px] text-muted-foreground">bottom</span>
      </div>

      {changed && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-full text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deriveVariantAction(assetId, variant.ratio, offset);
              onDone(result.ok ? (result.message ?? "Re-cropped.") : result.error);
            })
          }
        >
          {pending ? "Re-cropping…" : `Re-crop at ${offset}%`}
        </Button>
      )}
    </div>
  );
}

export function VariantList({
  assetId,
  rating,
  variants,
}: {
  assetId: string;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  variants: {
    id: string;
    ratio: string;
    onR2: boolean;
    onTelegram: boolean;
    onFanvue: boolean;
    /** Position verticale du recadrage, 0 (haut) à 100 (bas). */
    cropOffset: number | null;
  }[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const missing = ALL_RATIOS.filter(
    (ratio) => !variants.some((variant) => variant.ratio === ratio),
  );

  return (
    <div className="space-y-4">
      {variants.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No variants yet. Derive a ratio below.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {variants.map((variant) => (
            <div key={variant.id} className="space-y-1.5">
              <MediaThumb
                variantId={variant.id}
                rating={rating}
                ratio={variant.ratio}
                className="aspect-[4/5]"
              />

              <CropOffset
                assetId={assetId}
                variant={variant}
                disabled={pending}
                onDone={setMessage}
              />
              <div className="flex flex-wrap gap-1">
                {/* Où ce Variant est disponible, donc ce qu'il peut alimenter. */}
                <Badge
                  variant={variant.onR2 ? "secondary" : "outline"}
                  className="h-4 px-1 text-[9px]"
                >
                  {variant.onR2 ? "on R2" : "not on R2"}
                </Badge>
                {variant.onTelegram && (
                  <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                    Telegram
                  </Badge>
                )}
                {variant.onFanvue && (
                  <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                    Fanvue
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">Derive a ratio:</span>
          {missing.map((ratio) => (
            <Button
              key={ratio}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deriveVariantAction(assetId, ratio);
                  setMessage(result.ok ? (result.message ?? null) : result.error);
                })
              }
            >
              <Plus className="size-3" />
              {ratio}
            </Button>
          ))}
        </div>
      )}

      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      <p className="text-xs text-muted-foreground">
        Every variant is cropped from the original, never from another variant:
        cropping a crop would lose image on every pass.
      </p>
    </div>
  );
}
