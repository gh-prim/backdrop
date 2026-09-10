"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderPlus, Plus, X } from "lucide-react";
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
 * N'apparaît qu'une fois des médias cochés — un seul suffit: on range aussi
 * bien une image que dix. Les deux gestes sont proposés côte à côte, et aucun
 * n'est obligatoire: cocher des médias sert d'abord à les regarder.
 */
export function AlbumBar({
  selected,
  albums,
  mixedPersonas = false,
  onClear,
}: {
  selected: string[];
  albums: AlbumOption[];
  /** La sélection couvre plusieurs personas: aucun album ne peut la recevoir. */
  mixedPersonas?: boolean;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing" | null>(null);
  if (selected.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">
          {selected.length} selected
        </span>

        {mixedPersonas ? (
          // Le dire ici plutôt qu'en erreur après coup: un album vise les
          // canaux d'une seule persona.
          <span className="text-xs text-muted-foreground">
            Albums belong to one persona — this selection spans several.
          </span>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setMode("new")}
            >
              <Plus className="size-3.5" />
              New album
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={albums.length === 0}
              title={
                albums.length === 0 ? "No album for this persona yet." : undefined
              }
              onClick={() => setMode("existing")}
            >
              <FolderPlus className="size-3.5" />
              Add to album
            </Button>
          </>
        )}

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
        mode={mode}
        onClose={() => setMode(null)}
        selected={selected}
        albums={albums}
        onDone={onClear}
      />
    </>
  );
}

function AlbumDialog({
  mode,
  onClose,
  selected,
  albums,
  onDone,
}: {
  /** `null` ferme le dialogue: le geste est déjà choisi dans la barre. */
  mode: "new" | "existing" | null;
  onClose: () => void;
  selected: string[];
  albums: AlbumOption[];
  onDone: () => void;
}) {
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
      onClose();
      onDone();
    }
    // Le déclencheur est le résultat, pas l'identité des callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "new" ? "New album" : "Add to an album"}
          </DialogTitle>
          <DialogDescription>
            {selected.length} media. An album groups them, it does not move them:
            they stay in the library.
          </DialogDescription>
        </DialogHeader>

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
              onClick={onClose}
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
