"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { AlertTriangle } from "lucide-react";
import { schedulePublicationAction, type ActionResult } from "@/app/actions/publications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MediaThumb } from "@/components/media-thumb";
import { cn } from "cn";

type Rating = "SFW" | "SUGGESTIVE" | "NSFW";

type ChannelOption = {
  id: string;
  platform: string;
  maxRating: Rating;
  state: string;
};

type VariantOption = {
  id: string;
  ratio: string;
  rating: Rating;
  hasPublicUrl: boolean;
};

const RATING_RANK: Record<Rating, number> = { SFW: 0, SUGGESTIVE: 1, NSFW: 2 };

function defaultScheduledAt(): string {
  const at = new Date(Date.now() + 60 * 60 * 1000);
  at.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function ComposerForm({
  personaName,
  channels,
  variants,
}: {
  personaName: string;
  channels: ChannelOption[];
  variants: VariantOption[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState("SINGLE");
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    schedulePublicationAction,
    null,
  );

  /** Rating le plus élevé de la sélection: c'est lui qui ferme des canaux. */
  const selectionRating = useMemo<Rating>(() => {
    const chosen = variants.filter((v) => selected.includes(v.id));
    return chosen.reduce<Rating>(
      (max, v) => (RATING_RANK[v.rating] > RATING_RANK[max] ? v.rating : max),
      "SFW",
    );
  }, [selected, variants]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : kind === "CAROUSEL"
          ? [...current, id]
          : [id],
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="kind" value={kind} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="variantIds" value={id} />
      ))}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Persona</Label>
              <div className="flex h-8 items-center text-sm font-medium">{personaName}</div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="kind">Type</Label>
              <select
                id="kind"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  setSelected((current) =>
                    event.target.value === "CAROUSEL" ? current : current.slice(0, 1),
                  );
                }}
                className="h-8 rounded-md border bg-transparent px-2 text-sm"
              >
                <option value="SINGLE">Post simple</option>
                <option value="CAROUSEL">Carrousel</option>
                <option value="REEL">Reel</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="scheduledAt">Programmation</Label>
              <Input
                id="scheduledAt"
                name="scheduledAt"
                type="datetime-local"
                required
                defaultValue={defaultScheduledAt()}
                className="h-8 w-56"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Canal</Label>
            <div className="flex flex-wrap gap-2">
              {channels.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Aucun canal connecté pour cette persona. Un owner peut en connecter un
                  depuis les Réglages.
                </p>
              )}
              {channels.map((channel) => {
                // Troisième couche du garde-fou (6.1): le canal interdit est
                // désactivé ET expliqué, pas simplement absent. L'opérateur
                // doit comprendre pourquoi Instagram est grisé.
                const blocked =
                  RATING_RANK[selectionRating] > RATING_RANK[channel.maxRating];
                return (
                  <label
                    key={channel.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                      blocked && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="radio"
                      name="channelAccountId"
                      value={channel.id}
                      disabled={blocked}
                      required
                    />
                    <span className="font-medium">{channel.platform}</span>
                    <Badge variant="outline" className="h-4 px-1 text-[9px]">
                      max {channel.maxRating}
                    </Badge>
                    {blocked && (
                      <span className="flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="size-3" />
                        média {selectionRating} interdit ici
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="caption">Légende</Label>
            <textarea
              id="caption"
              name="caption"
              rows={3}
              maxLength={2200}
              className="w-full rounded-md border bg-transparent p-2 text-sm"
              placeholder="Légende Instagram, 2200 caractères maximum."
            />
          </div>

          {kind === "REEL" && (
            <div className="space-y-1.5">
              <Label htmlFor="audioId">Audio Instagram (optionnel)</Label>
              <Input id="audioId" name="audioId" className="h-8 w-72" />
              <p className="text-xs text-muted-foreground">
                Reels uniquement. Aucune prévisualisation possible: ce qui est configuré
                part en production tel quel.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-baseline justify-between">
            <Label>Médias {kind === "CAROUSEL" && "(jusqu'à 10, dans l'ordre choisi)"}</Label>
            <span className="text-xs text-muted-foreground">
              {selected.length} sélectionné{selected.length > 1 ? "s" : ""}
            </span>
          </div>

          {variants.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Aucun Variant dérivé pour cette persona. Passez par la Library.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {variants.map((variant) => {
                const index = selected.indexOf(variant.id);
                return (
                  // Un div et non un button: la vignette contient elle-même un
                  // contrôle « Révéler », et un bouton imbriqué dans un bouton
                  // est du HTML invalide qui casse l'hydratation.
                  <div
                    key={variant.id}
                    role="checkbox"
                    aria-checked={index >= 0}
                    tabIndex={0}
                    onClick={() => toggle(variant.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggle(variant.id);
                      }
                    }}
                    className={cn(
                      "relative cursor-pointer rounded-md ring-offset-2 ring-offset-background transition",
                      index >= 0 && "ring-2 ring-primary",
                    )}
                  >
                    <MediaThumb
                      variantId={variant.id}
                      rating={variant.rating}
                      ratio={variant.ratio}
                      className="aspect-[4/5]"
                    />
                    {index >= 0 && kind === "CAROUSEL" && (
                      <span className="absolute right-1 top-1 rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                        {index + 1}
                      </span>
                    )}
                    {!variant.hasPublicUrl && (
                      <span className="absolute bottom-1 left-1 rounded bg-destructive px-1 text-[9px] text-destructive-foreground">
                        pas sur R2
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-muted-foreground">{state.message}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || selected.length === 0}>
          {pending ? "Programmation…" : "Programmer"}
        </Button>
        {/* Même chemin que « Programmer », avec une échéance à l'instant. */}
        <Button
          type="submit"
          name="publishNow"
          value="1"
          variant="secondary"
          disabled={pending || selected.length === 0}
        >
          {pending ? "Envoi…" : "Publier tout de suite"}
        </Button>
      </div>
    </form>
  );
}
