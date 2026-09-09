"use client";

import { useState } from "react";
import { EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "cn";

/**
 * Aperçu du fichier original, servi par la route authentifiée.
 * Le flou des médias sensibles s'applique ici aussi: la fiche d'un média n'est
 * pas un endroit où l'on baisse la garde (6.1).
 */
export function AssetOriginal({
  assetId,
  rating,
  isVideo,
}: {
  assetId: string;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  isVideo: boolean;
}) {
  const [revealed, setRevealed] = useState(rating === "SFW");
  const src = `/api/media/asset/${assetId}`;

  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="relative bg-black/40 p-0">
        <div className="absolute left-3 top-3 z-10 flex gap-1">
          <Badge
            variant={rating === "SFW" ? "secondary" : "destructive"}
            className="text-[10px]"
          >
            {rating}
          </Badge>
          <Badge variant="outline" className="bg-background/70 text-[10px]">
            original
          </Badge>
        </div>

        {isVideo ? (
          <video
            src={src}
            controls
            className={cn(
              "max-h-[60vh] w-full object-contain transition",
              !revealed && "blur-2xl",
            )}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className={cn(
              "max-h-[60vh] w-full object-contain transition",
              !revealed && "scale-105 blur-2xl",
            )}
          />
        )}

        {!revealed && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-sm"
          >
            <EyeOff className="size-5" />
            Révéler
          </button>
        )}
      </CardContent>
    </Card>
  );
}
