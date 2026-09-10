"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  deleteAlbumAction,
  renameAlbumAction,
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

export function AlbumProperties({
  albumId,
  name,
  count,
}: {
  albumId: string;
  name: string;
  count: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();

  const [state, action, pending] = useActionState<AlbumResult | null, FormData>(
    renameAlbumAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Renamed.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-1.5">
        <input type="hidden" name="albumId" value={albumId} />
        <label htmlFor="album-name" className="text-xs text-muted-foreground">
          Name
        </label>
        <div className="flex gap-2">
          <Input
            id="album-name"
            name="name"
            defaultValue={name}
            required
            className="h-8"
          />
          <Button type="submit" size="sm" className="h-8" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
        {state?.ok === false && (
          <p className="text-xs text-destructive">{state.error}</p>
        )}
      </form>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start gap-1.5 text-destructive hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-3.5" />
        Delete album
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{name}”?</DialogTitle>
            <DialogDescription>
              {/* Le dire explicitement: un album ressemble à un dossier, et on
                  craint de perdre ce qu'il contient. */}
              The {count} media stay in the library. Only the grouping goes.
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
              disabled={deleting}
              onClick={() =>
                startDelete(async () => {
                  const result = await deleteAlbumAction(albumId);
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(result.message ?? "Deleted.");
                  // L'album n'existe plus: rester sur sa page afficherait un
                  // 404 au premier rafraîchissement.
                  router.push("/library");
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
