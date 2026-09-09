"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { updateAssetAction, deleteAssetAction, type ActionResult } from "@/app/actions/asset-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";

const RATINGS = [
  { value: "SFW", label: "SFW", hint: "Publishable on Instagram, pushed to R2." },
  { value: "SUGGESTIVE", label: "Suggestive", hint: "Blocked on Instagram." },
  { value: "NSFW", label: "NSFW", hint: "Blocked on Instagram." },
] as const;

export function PropertiesForm({
  assetId,
  name,
  description,
  rating,
  usageCount,
}: {
  assetId: string;
  name: string;
  description: string;
  rating: string;
  usageCount: number;
}) {
  const router = useRouter();
  const [selectedRating, setSelectedRating] = useState(rating);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateAssetAction,
    null,
  );

  const leavingSfw = rating === "SFW" && selectedRating !== "SFW";

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="assetId" value={assetId} />

        <div className="space-y-1.5">
          <Label htmlFor="assetName">Name</Label>
          <Input
            id="assetName"
            name="name"
            defaultValue={name}
            placeholder="Park yoga session"
            className="h-8"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="assetDescription">Description</Label>
          <textarea
            id="assetDescription"
            name="description"
            rows={3}
            defaultValue={description}
            maxLength={2000}
            placeholder="Internal note: context, outfit, series…"
            className="w-full rounded-md border bg-transparent p-2 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Rating</Label>
          <input type="hidden" name="rating" value={selectedRating} />
          <div className="space-y-1">
            {RATINGS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedRating(option.value)}
                className={cn(
                  "w-full rounded-md border px-2.5 py-1.5 text-left transition-colors",
                  selectedRating === option.value
                    ? "border-primary bg-accent"
                    : "hover:bg-accent/40",
                )}
              >
                <span className="block text-xs font-medium">{option.label}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {option.hint}
                </span>
              </button>
            ))}
          </div>

          {leavingSfw && (
            // Conséquence physique, pas seulement logique: l'URL publique
            // disparaît, sinon le fichier resterait téléchargeable (section 5).
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
              Variants will be removed from R2: non-SFW media keeps no public URL.
              You will need to derive them again to go back to SFW.
            </p>
          )}
          {usageCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Used by {usageCount} publication{usageCount > 1 ? "s" : ""}: the database
              will refuse a rating one of their channels does not accept.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {state && !state.ok && (
            <span className="text-[11px] text-destructive">{state.error}</span>
          )}
          {state?.ok && (
            <span className="text-[11px] text-muted-foreground">{state.message}</span>
          )}
        </div>
      </form>

      <div className="border-t pt-3">
        {confirming ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Permanently delete this media, its variants, its local files and its
              R2 objects?
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError(null);
                  const result = await deleteAssetAction(assetId);
                  // Une suppression réussie redirige côté serveur; si on est
                  // encore là, c'est qu'elle a été refusée.
                  if (result && !result.ok) setDeleteError(result.error);
                  setDeleting(false);
                  router.refresh();
                }}
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : "Delete"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
            {deleteError && (
              <p className="text-[11px] text-destructive">{deleteError}</p>
            )}
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-3.5" />
            Delete this media
          </Button>
        )}
      </div>
    </div>
  );
}
