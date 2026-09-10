"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Images, Pencil, Trash2 } from "lucide-react";
import {
  deleteAlbumAction,
  renameAlbumAction,
  type AlbumResult,
} from "@/app/actions/albums";
import { AlbumMosaic } from "@/components/album-mosaic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AlbumCard = {
  id: string;
  name: string;
  personaName: string;
  count: number;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  mosaic: string[];
};

/**
 * Onglet des albums.
 *
 * Un album est un raccourci d'envoi: on l'ouvre pour composer tout son contenu
 * d'un geste, plutôt que de recocher cinq médias à chaque fois. Il ne retire
 * rien de la bibliothèque — un média rangé dans un album reste dans l'onglet
 * d'à côté, où on le retrouve avec tous les autres.
 */
export function AlbumShelf({ albums }: { albums: AlbumCard[] }) {
  const [renaming, setRenaming] = useState<AlbumCard | null>(null);

  if (albums.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No album yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick several media in the Library tab, then group them. The media stay
          where they are.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Send the whole set in one go, in the ratio you pick.
      </p>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {albums.map((album) => (
          <AlbumTile key={album.id} album={album} onRename={() => setRenaming(album)} />
        ))}
      </div>

      <RenameDialog album={renaming} onClose={() => setRenaming(null)} />
    </section>
  );
}

function AlbumTile({
  album,
  onRename,
}: {
  album: AlbumCard;
  onRename: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="group/album space-y-1.5">
      {/* Ouvrir l'album, c'est voir ce qu'il contient et dans quel ordre il
          partira: la mosaïque n'en montre que quatre vignettes. */}
      <Link href={`/library/albums/${album.id}`} className="block">
        <AlbumMosaic
          variantIds={album.mosaic}
          rating={album.rating}
          className="aspect-square transition-opacity hover:opacity-90"
        />
      </Link>

      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <Link
            href={`/library/albums/${album.id}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {album.name}
          </Link>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Images className="size-3" />
            {album.count} · {album.personaName}
          </p>
        </div>

        <div className="flex opacity-0 transition-opacity group-hover/album:opacity-100 focus-within:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Rename ${album.name}`}
            onClick={onRename}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${album.name}`}
            disabled={pending}
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{album.name}”?</DialogTitle>
            <DialogDescription>
              {/* Le dire explicitement: un album ressemble à un dossier, et on
                  craint de perdre ce qu'il contient. */}
              The {album.count} media stay in the library. Only the grouping goes.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteAlbumAction(album.id);
                  if (result.ok) toast.success(result.message ?? "Deleted.");
                  else toast.error(result.error);
                  setConfirming(false);
                })
              }
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RenameDialog({
  album,
  onClose,
}: {
  album: AlbumCard | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<AlbumResult | null, FormData>(
    renameAlbumAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Renamed.");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={album !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename album</DialogTitle>
        </DialogHeader>

        <form action={action} className="space-y-3">
          <input type="hidden" name="albumId" value={album?.id ?? ""} />
          <Input
            name="name"
            defaultValue={album?.name ?? ""}
            required
            autoFocus
            className="h-8 w-full"
          />
          {state?.ok === false && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-8" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
