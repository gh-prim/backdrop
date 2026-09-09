"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { deriveVariantAction } from "@/app/actions/asset-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaThumb } from "@/components/media-thumb";

const ALL_RATIOS = ["4:5", "9:16", "1:1"];

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
          Aucun Variant. Dérivez un ratio ci-dessous.
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
              <div className="flex flex-wrap gap-1">
                {/* Où ce Variant est disponible, donc ce qu'il peut alimenter. */}
                <Badge
                  variant={variant.onR2 ? "secondary" : "outline"}
                  className="h-4 px-1 text-[9px]"
                >
                  {variant.onR2 ? "sur R2" : "pas sur R2"}
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
          <span className="text-xs text-muted-foreground">Dériver un ratio:</span>
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
        Chaque Variant est recadré depuis l&apos;original, jamais depuis un autre
        Variant: recadrer un recadrage perdrait de l&apos;image à chaque passage.
      </p>
    </div>
  );
}
