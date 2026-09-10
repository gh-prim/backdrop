"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderPlus, X } from "lucide-react";
import {
  addToAlbumAction,
  createAlbumAction,
  type AlbumResult,
} from "@/app/actions/albums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AlbumOption = { id: string; name: string; personaId: string; count: number };

/**
 * Barre d'action de la sélection.
 *
 * N'apparaît qu'une fois des médias cochés: une barre permanente et vide
 * occuperait de la place pour ne rien proposer.
 */
export function AlbumBar({
  selected,
  albums,
  onClear,
}: {
  selected: string[];
  albums: AlbumOption[];
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (selected.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">
          {selected.length} selected
        </span>

        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setOpen(true)}
        >
          <FolderPlus className="size-3.5" />
          Add to album
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1"
          onClick={onClear}
        >
          <X className="size-3.5" />
          Clear
        </Button>
      </div>

      <AlbumDialog
        open={open}
        onOpenChange={setOpen}
        selected={selected}
        albums={albums}
        onDone={onClear}
      />
    </>
  );
}

function AlbumDialog({
  open,
  onOpenChange,
  selected,
  albums,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  albums: AlbumOption[];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">(
    albums.length > 0 ? "existing" : "new",
  );

  const [createState, create, creating] = useActionState<AlbumResult | null, FormData>(
    createAlbumAction,
    null,
  );
  const [addState, add, adding] = useActionState<AlbumResult | null, FormData>(
    addToAlbumAction,
    null,
  );

  const state = mode === "new" ? createState : addState;

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Done.");
      onOpenChange(false);
      onDone();
    }
    // Le déclencheur est le résultat, pas l'identité des callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {selected.length} media to an album</DialogTitle>
          <DialogDescription>
            An album groups media, it does not move them: they stay in the library.
          </DialogDescription>
        </DialogHeader>

        {albums.length > 0 && (
          <div className="flex gap-1 rounded-md border p-0.5 text-xs">
            {(["existing", "new"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={
                  mode === value
                    ? "flex-1 rounded bg-accent px-2 py-1 font-medium"
                    : "flex-1 rounded px-2 py-1 text-muted-foreground hover:text-foreground"
                }
              >
                {value === "existing" ? "Existing album" : "New album"}
              </button>
            ))}
          </div>
        )}

        <form action={mode === "new" ? create : add} className="space-y-3">
          {selected.map((id) => (
            <input key={id} type="hidden" name="assetIds" value={id} />
          ))}

          {mode === "new" ? (
            <div className="space-y-1.5">
              <label htmlFor="album-name" className="text-xs text-muted-foreground">
                Album name
              </label>
              <Input
                id="album-name"
                name="name"
                required
                autoFocus
                placeholder="Locker room — September"
                className="h-8 w-full"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="album-id" className="text-xs text-muted-foreground">
                Album
              </label>
              <select
                id="album-id"
                name="albumId"
                className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
              >
                {albums.map((album) => (
                  <option key={album.id} value={album.id}>
                    {album.name} · {album.count} media
                  </option>
                ))}
              </select>
            </div>
          )}

          {state?.ok === false && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-8" disabled={creating || adding}>
              {creating || adding ? "Saving…" : mode === "new" ? "Create" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
