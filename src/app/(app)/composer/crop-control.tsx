"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deriveVariantAction, variantCropOffsetAction } from "@/app/actions/asset-detail";

/** Au-delà, ce n'est plus une attente: c'est une panne à signaler. */
const GIVE_UP_AFTER_MS = 120_000;
const POLL_EVERY_MS = 1_500;

/**
 * Déplacer le recadrage sans quitter le compositeur.
 *
 * Le cadrage se juge au moment où l'on monte le post, pas sur la fiche du
 * média: c'est là qu'on voit que le visage est coupé. Sortir pour corriger,
 * c'est perdre la sélection en cours.
 *
 * La re-dérivation est asynchrone — Temporal rend la main avant ffmpeg. On
 * attend donc que `cropOffset` bouge en base avant de rafraîchir l'aperçu:
 * afficher l'ancienne image en annonçant la nouvelle serait pire que ne rien
 * afficher.
 */
export function CropControl({
  variant,
  onRecropped,
}: {
  variant: { id: string; assetId: string; ratio: string; cropOffset: number | null };
  onRecropped: (variantId: string, cropOffset: number) => void;
}) {
  const applied = variant.cropOffset ?? 50;
  const [offset, setOffset] = useState(applied);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // `applied` change quand le parent apprend le nouveau cadrage: on resynchronise
  // sans effet, par la clé de rendu côté appelant.
  const moved = offset !== applied;

  function recrop() {
    startTransition(async () => {
      setStatus(null);
      const started = await deriveVariantAction(variant.assetId, variant.ratio, offset);
      if (!started.ok) {
        setStatus(started.error);
        return;
      }

      const deadline = Date.now() + GIVE_UP_AFTER_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
        const current = await variantCropOffsetAction(variant.id);
        if (current && (current.cropOffset ?? 50) === offset) {
          onRecropped(variant.id, offset);
          setStatus(null);
          return;
        }
      }

      setStatus("Still re-cropping. The preview will be right once it lands.");
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[11px] text-muted-foreground">top</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={offset}
          disabled={pending}
          onChange={(event) => setOffset(Number(event.target.value))}
          className="h-1 flex-1"
          aria-label={`Vertical crop for the ${variant.ratio} media`}
        />
        <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground">
          bottom
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          // Sans déplacement il n'y a rien à recalculer: le bouton reste là,
          // mais inerte, plutôt que d'apparaître et disparaître sous le doigt.
          disabled={pending || !moved}
          onClick={recrop}
        >
          {pending ? "Re-cropping…" : moved ? `Re-crop at ${offset}%` : "Move the slider"}
        </Button>
        {status && <span className="text-[11px] text-destructive">{status}</span>}
      </div>
    </div>
  );
}
