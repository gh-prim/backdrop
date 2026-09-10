"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Images, Loader2 } from "lucide-react";
import {
  listAlbumChoicesAction,
  resolveAlbumAction,
  type AlbumChoice,
} from "@/app/actions/album-pick";
import { AlbumMosaic } from "@/components/album-mosaic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * Envoi d'un album entier depuis le composeur.
 *
 * C'est la raison d'être des albums: recocher cinq médias à chaque envoi est
 * exactement le travail qu'un regroupement doit supprimer.
 *
 * Le ratio se choisit **ici**, pas à la composition de l'album: le même album
 * part en 4:5 pour un post et en 9:16 pour un Reel.
 */
export function AlbumPicker({
  personaId,
  onPick,
}: {
  personaId: string;
  /**
   * Rend la main au composeur, qui seul connaît les canaux choisis: c'est lui
   * qui écarte un média trop explicite pour le plus restrictif d'entre eux,
   * et qui affiche le bilan — il reste lisible après le retour à la grille,
   * alors qu'un message posé ici disparaîtrait avec ce panneau.
   */
  onPick: (pick: {
    variantIds: string[];
    ratio: string;
    albumName: string;
    missing: number;
  }) => void;
}) {
  const [albums, setAlbums] = useState<AlbumChoice[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void listAlbumChoicesAction(personaId).then((result) => {
      if (alive) setAlbums(result);
    });
    return () => {
      alive = false;
    };
  }, [personaId]);

  if (albums === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Reading albums…
      </p>
    );
  }

  if (albums.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
        No album yet. Select media in the library and group them: you can then
        send the whole set in one go.
      </p>
    );
  }

  function pick(album: AlbumChoice, ratio: string) {
    setNote(null);
    startTransition(async () => {
      const result = await resolveAlbumAction(album.id, ratio);
      if (!result.ok) {
        setNote(result.error);
        return;
      }

      setOpenId(null);
      onPick({
        variantIds: result.variantIds,
        ratio,
        albumName: album.name,
        missing: result.missing.length,
      });
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {albums.map((album) => {
          const open = openId === album.id;
          return (
            <div key={album.id} className="space-y-1.5">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : album.id)}
                className={cn(
                  "block w-full rounded-md transition-opacity hover:opacity-90",
                  open && "ring-2 ring-primary",
                )}
              >
                <AlbumMosaic
                  variantIds={album.mosaic}
                  rating={album.rating}
                  className="aspect-square"
                />
              </button>

              <p className="truncate text-xs font-medium">{album.name}</p>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Images className="size-3" />
                {album.count}
              </p>

              {open && (
                <div className="space-y-1">
                  {album.ratios.length === 0 ? (
                    <p className="flex items-start gap-1 text-[11px] text-destructive">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      {/* Un ratio n'est proposé que si **tous** les médias
                          l'ont: un carrousel mêlant deux cadrages est laid, et
                          Instagram ne le rattrape pas. */}
                      No ratio shared by every media of this album.
                    </p>
                  ) : (
                    <>
                      <p className="text-[11px] text-muted-foreground">Send in</p>
                      <div className="flex flex-wrap gap-1">
                        {album.ratios.map((ratio) => (
                          <Button
                            key={ratio}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={pending}
                            onClick={() => pick(album, ratio)}
                          >
                            {ratio}
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {note && (
        <p className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">{note}</p>
      )}
    </div>
  );
}
