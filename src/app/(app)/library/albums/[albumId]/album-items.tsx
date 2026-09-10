"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { removeFromAlbumAction } from "@/app/actions/albums";
import { MediaThumb } from "@/components/media-thumb";
import { Badge } from "@/components/ui/badge";

export type AlbumItem = {
  assetId: string;
  label: string;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  thumbVariantId: string | null;
  ratios: string[];
};

/**
 * Contenu de l'album, dans l'ordre d'envoi.
 *
 * La position est affichée: c'est celle du carrousel une fois publié, et rien
 * d'autre à l'écran ne la donne.
 */
export function AlbumItems({
  albumId,
  items,
}: {
  albumId: string;
  items: AlbumItem[];
}) {
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        This album is empty. Pick media in the library and add them here.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((item, index) => (
        <div key={item.assetId} className="group/item space-y-1.5">
          <div className="relative">
            <Link href={`/library/${item.assetId}`}>
              {item.thumbVariantId ? (
                <MediaThumb
                  variantId={item.thumbVariantId}
                  rating={item.rating}
                  className="aspect-[4/5]"
                />
              ) : (
                <span className="flex aspect-[4/5] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                  No variant yet
                </span>
              )}
            </Link>

            <span className="absolute left-1 top-1 rounded bg-background/80 px-1.5 text-[10px] font-bold">
              {index + 1}
            </span>

            <button
              type="button"
              aria-label={`Remove ${item.label} from the album`}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeFromAlbumAction(albumId, item.assetId);
                  if (result.ok) toast.success(result.message ?? "Removed.");
                  else toast.error(result.error);
                })
              }
              className="absolute right-1 top-1 rounded bg-background/80 p-1 opacity-0 transition-opacity hover:text-destructive group-hover/item:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <p className="truncate text-xs">{item.label}</p>
          <div className="flex flex-wrap gap-1">
            {item.ratios.map((ratio) => (
              <Badge key={ratio} variant="outline" className="h-4 px-1 text-[10px]">
                {ratio}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
