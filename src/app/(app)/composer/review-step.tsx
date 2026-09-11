"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaThumb } from "@/components/media-thumb";
import { PlatformLogo } from "@/components/platform-logo";
import { INSTAGRAM_FEED_RATIOS } from "@/lib/channels/instagram";
import { resolveVariantAction } from "@/app/actions/asset-detail";
import { cn } from "cn";

type Platform = "INSTAGRAM" | "TELEGRAM" | "FANVUE";
type Rating = "SFW" | "SUGGESTIVE" | "NSFW";

export type ReviewMedia = {
  variantId: string;
  assetId: string;
  ratio: string;
  rating: Rating;
  cropOffset: number | null;
};

export type ReviewChannel = {
  id: string;
  platform: Platform;
};

/** Ce que la dérivation sait produire, du plus large au plus haut. */
const ALL_RATIOS = ["1:1", "4:5", "3:4", "9:16"];

/** Le plus haut que le fil Instagram accepte: celui qui coupe le moins. */
const FEED_TALLEST = [...INSTAGRAM_FEED_RATIOS].reduce((tallest, ratio) =>
  ratioValue(ratio) < ratioValue(tallest) ? ratio : tallest,
);

function ratioValue(ratio: string): number {
  const [width, height] = ratio.split(":").map(Number);
  return width / height;
}

/**
 * Les cadres qu'un canal accepte vraiment.
 *
 * Instagram impose les siens: proposer un 9:16 pour le fil reviendrait à
 * offrir un cadrage qu'il recouperait derrière notre dos — c'est précisément
 * ce qu'on cherche à faire cesser. Telegram et Fanvue affichent ce qu'on leur
 * envoie: tout leur va.
 */
export function ratiosFor(platform: Platform, kind: string): string[] {
  if (platform !== "INSTAGRAM") return ALL_RATIOS;
  return kind === "REEL" ? ["9:16"] : [...INSTAGRAM_FEED_RATIOS];
}

/**
 * Le cadre par défaut d'un canal pour un média donné.
 *
 * Sur Instagram, on ne reprend pas le cadrage du média: un 9:16 envoyé au fil
 * s'y fait recouper au centre, ce qui coupe la tête aussi souvent que les
 * pieds. On vise donc d'emblée le plus haut que le fil accepte.
 */
export function defaultFraming(
  platform: Platform,
  kind: string,
  media: ReviewMedia,
): { ratio: string; cropOffset: number } {
  const allowed = ratiosFor(platform, kind);
  const ratio = allowed.includes(media.ratio)
    ? media.ratio
    : (allowed.includes(FEED_TALLEST) ? FEED_TALLEST : allowed[0]);
  return { ratio, cropOffset: media.cropOffset ?? 50 };
}

type Framing = { ratio: string; cropOffset: number };
type Plan = Record<string, Record<string, Framing>>;

/**
 * La clé d'un fichier déjà résolu.
 *
 * Elle porte le cadrage demandé, et pas seulement le canal et le média: un
 * fichier trouvé pour un 4:5 centré ne répond pas à une demande de 3:4 en
 * haut. Sans ça, changer un réglage resservirait l'image précédente.
 */
function resolvedKey(channelId: string, assetId: string, framing: Framing): string {
  return `${channelId}:${assetId}@${framing.ratio}:${framing.cropOffset}`;
}

/**
 * L'écran de confirmation: ce que chaque canal recevra, pour de vrai.
 *
 * Jusqu'ici le cadrage se découvrait une fois publié. Ici chaque vignette est
 * le **fichier** qui partira — pas une simulation en CSS: si l'image n'existe
 * pas encore dans ce cadre, elle est dérivée et l'écran attend. Cliquer sur
 * l'une d'elles ouvre son réglage, canal par canal: deux plateformes n'ont
 * aucune raison de vouloir le même point de coupe.
 */
export function ReviewStep({
  channels,
  media,
  kind,
  onResolved,
}: {
  channels: ReviewChannel[];
  media: ReviewMedia[];
  kind: string;
  /** Les variantes retenues par canal, ou `null` tant que tout n'est pas prêt. */
  onResolved: (plan: Record<string, string[]> | null) => void;
}) {
  /**
   * Seulement ce que l'opérateur a changé.
   *
   * Le plan complet se calcule au rendu, à partir des défauts: le garder en
   * état obligerait à le recopier à chaque canal ajouté ou média retiré, et
   * un état qui se recopie tout seul finit toujours par diverger de ce qu'il
   * décrit.
   */
  const [overrides, setOverrides] = useState<Plan>({});
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ channelId: string; assetId: string } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);

  const plan = useMemo<Plan>(() => {
    const next: Plan = {};
    for (const channel of channels) {
      const forChannel: Record<string, Framing> = {};
      for (const item of media) {
        forChannel[item.assetId] =
          overrides[channel.id]?.[item.assetId] ??
          defaultFraming(channel.platform, kind, item);
      }
      next[channel.id] = forChannel;
    }
    return next;
  }, [channels, media, kind, overrides]);

  /**
   * Résout un cadrage en fichier, en attendant ffmpeg s'il le faut.
   *
   * `resolveVariantAction` rend `null` quand la dérivation vient de partir:
   * on rappelle plutôt que de tenir une connexion ouverte le temps d'un
   * encodage.
   */
  const resolve = useCallback(
    async (channelId: string, item: ReviewMedia, framing: Framing, signal: AbortSignal) => {
      for (let attempt = 0; attempt < 80 && !signal.aborted; attempt += 1) {
        const found = await resolveVariantAction(
          item.assetId,
          framing.ratio,
          framing.cropOffset,
        );
        if (signal.aborted) return;
        if (found) {
          setResolved((previous) => ({
            ...previous,
            [resolvedKey(channelId, item.assetId, framing)]: found.variantId,
          }));
          return;
        }
        await new Promise((done) => setTimeout(done, 1_500));
      }
      if (!signal.aborted) {
        setFailed("A framing is taking too long to render. Check the worker.");
      }
    },
    [],
  );

  // Une abort par passage: changer un cadrage pendant qu'un autre se dérive ne
  // doit pas laisser l'ancienne attente réécrire le résultat.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      const waiting: Promise<void>[] = [];
      for (const channel of channels) {
        for (const item of media) {
          const framing = plan[channel.id]?.[item.assetId];
          if (!framing) continue;
          if (resolved[resolvedKey(channel.id, item.assetId, framing)]) continue;
          waiting.push(resolve(channel.id, item, framing, controller.signal));
        }
      }
      await Promise.all(waiting);
    })();

    return () => controller.abort();
    // `resolved` est lu ici mais volontairement hors des dépendances: il est
    // écrit par cet effet, et le relire relancerait la boucle à chaque fichier
    // trouvé. Le pire cas est une résolution lancée deux fois, qui est
    // idempotente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, media, plan, resolve]);

  // Remonte le résultat dès qu'il est complet, et `null` sinon: le bouton
  // d'envoi doit rester fermé tant qu'un cadre manque.
  useEffect(() => {
    const out: Record<string, string[]> = {};
    for (const channel of channels) {
      const ids: string[] = [];
      for (const item of media) {
        const framing = plan[channel.id]?.[item.assetId];
        const variantId = framing
          ? resolved[resolvedKey(channel.id, item.assetId, framing)]
          : undefined;
        if (!variantId) {
          onResolved(null);
          return;
        }
        ids.push(variantId);
      }
      out[channel.id] = ids;
    }
    onResolved(out);
  }, [channels, media, plan, resolved, onResolved]);

  if (channels.length === 0 || media.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Pick at least one channel and one media first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Exactly what each channel will receive. Click a frame to adjust it — the
        change applies to that channel only.
      </p>

      {failed && <p className="text-xs text-destructive">{failed}</p>}

      <div className="space-y-4">
        {channels.map((channel) => (
          <div key={channel.id} className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <PlatformLogo platform={channel.platform} className="size-4" />
              {channel.platform}
            </p>

            <div className="flex flex-wrap gap-2">
              {media.map((item, index) => {
                const framing = plan[channel.id]?.[item.assetId];
                const variantId = framing
                  ? resolved[resolvedKey(channel.id, item.assetId, framing)]
                  : undefined;
                const open =
                  editing?.channelId === channel.id && editing?.assetId === item.assetId;

                return (
                  <button
                    key={item.assetId}
                    type="button"
                    onClick={() =>
                      setEditing(
                        open ? null : { channelId: channel.id, assetId: item.assetId },
                      )
                    }
                    className={cn(
                      "relative overflow-hidden rounded-md border transition",
                      open ? "border-primary ring-2 ring-primary" : "hover:border-foreground",
                    )}
                    style={{
                      width: 88,
                      aspectRatio: (framing?.ratio ?? item.ratio).replace(":", " / "),
                    }}
                  >
                    {variantId ? (
                      <MediaThumb
                        variantId={variantId}
                        rating={item.rating}
                        className="size-full border-0"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center bg-muted">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </span>
                    )}

                    {media.length > 1 && (
                      <span className="absolute right-1 top-1 rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                        {index + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {editing?.channelId === channel.id && (
              <FrameEditor
                platform={channel.platform}
                kind={kind}
                framing={plan[channel.id]?.[editing.assetId]}
                onChange={(framing) =>
                  setOverrides((previous) => ({
                    ...previous,
                    [channel.id]: {
                      ...(previous[channel.id] ?? {}),
                      [editing.assetId]: framing,
                    },
                  }))
                }
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Le réglage d'un cadre: quel cadre, et où il tombe.
 *
 * Les deux comptent et ne se remplacent pas. Choisir le 3:4 plutôt que le 4:5
 * décide de ce qu'on garde; le curseur décide d'où on le garde.
 */
function FrameEditor({
  platform,
  kind,
  framing,
  onChange,
}: {
  platform: Platform;
  kind: string;
  framing?: Framing;
  onChange: (framing: Framing) => void;
}) {
  if (!framing) return null;
  const allowed = ratiosFor(platform, kind);

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-2">
      {allowed.length > 1 && (
        <div className="flex items-center gap-1.5">
          <span className="w-14 shrink-0 text-[11px] text-muted-foreground">Frame</span>
          {allowed.map((ratio) => (
            <Button
              key={ratio}
              type="button"
              size="sm"
              variant={ratio === framing.ratio ? "default" : "outline"}
              className="h-6 px-2 text-[11px]"
              onClick={() => onChange({ ...framing, ratio })}
            >
              {ratio}
            </Button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[11px] text-muted-foreground">Top</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={framing.cropOffset}
          onChange={(event) =>
            onChange({ ...framing, cropOffset: Number(event.target.value) })
          }
          className="h-1 flex-1"
          aria-label="Vertical crop"
        />
        <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground">
          Bottom
        </span>
      </div>
    </div>
  );
}
