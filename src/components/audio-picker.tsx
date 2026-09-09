"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ExternalLink, Music, Play, Search, X } from "lucide-react";
import { WaveformPlayer } from "@/components/waveform-player";
import {
  getInstagramAudioAction,
  searchInstagramAudioAction,
  type AudioSearchResult,
} from "@/app/actions/audio";
import type { InstagramAudioType } from "@/lib/channels/instagram";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";

export type SelectedAudio = {
  audioId: string;
  title: string;
  artist: string;
  audioVolume: number;
  videoVolume: number;
};

type Track = {
  audioId: string;
  title: string;
  artist: string;
  durationMs: number;
  previewUrl: string | null;
  creatorHandle: string | null;
};

function duration(ms: number) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Sélecteur de piste audio Instagram (Reels uniquement, 4.1.5).
 *
 * Aucune écoute n'est possible depuis l'API: on renvoie vers la page Instagram
 * de la piste. C'est une limite du catalogue exposé, pas un raccourci.
 */
export function AudioPicker({
  channelAccountId,
  selected,
  onSelect,
}: {
  channelAccountId: string;
  selected: SelectedAudio | null;
  onSelect: (audio: SelectedAudio | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [audioType, setAudioType] = useState<InstagramAudioType>("music");
  const [result, setResult] = useState<AudioSearchResult | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Piste en cours d'écoute. Meta ne fournit d'URL audio que pour les sons
   * originaux: sur la musique sous licence, on renvoie vers Instagram.
   */
  const [playing, setPlaying] = useState<{
    audioId: string;
    playable: boolean;
    fallback: string | null;
  } | null>(null);

  function run(nextQuery: string, nextType: InstagramAudioType = audioType) {
    startTransition(async () => {
      setPlaying(null);
      setResult(
        await searchInstagramAudioAction(channelAccountId, nextQuery, nextType),
      );
    });
  }

  function preview(audioId: string) {
    startTransition(async () => {
      const detail = await getInstagramAudioAction(channelAccountId, audioId);
      setPlaying(
        detail.ok
          ? {
              audioId,
              // Seuls les sons originaux ont un master distribué par Meta.
              playable: Boolean(detail.detail.downloadUrl),
              fallback: detail.detail.previewUrl,
            }
          : { audioId, playable: false, fallback: null },
      );
    });
  }

  // Tendances au chargement: un champ de recherche vide n'aide personne.
  useEffect(() => {
    run("", "music");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelAccountId]);

  const tracks: Track[] = result?.ok ? result.tracks : [];

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5">
          <Music className="size-3.5" />
          Musique Instagram
        </Label>
        {selected && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onSelect(null)}
          >
            <X className="size-3" />
            Retirer
          </Button>
        )}
      </div>

      {selected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-primary bg-accent px-3 py-2 text-sm">
            <Check className="size-3.5 shrink-0" />
            <span className="font-medium">{selected.title}</span>
            <span className="text-muted-foreground">{selected.artist}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <VolumeSlider
              label="Volume de la musique"
              value={selected.audioVolume}
              onChange={(audioVolume) => onSelect({ ...selected, audioVolume })}
            />
            <VolumeSlider
              label="Volume de la vidéo"
              value={selected.videoVolume}
              onChange={(videoVolume) => onSelect({ ...selected, videoVolume })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Vidéo à 0 si la musique est déjà incrustée au montage, sinon vous
            l&apos;entendrez deux fois. Aucune prévisualisation n&apos;existe: ce qui
            est réglé ici part en production tel quel.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 rounded-md border p-0.5 text-xs">
            {(
              [
                ["music", "Musique"],
                ["original_sound", "Sons originaux"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setAudioType(value);
                  run(query, value);
                }}
                className={cn(
                  "flex-1 rounded px-2 py-1 transition-colors",
                  audioType === value
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  run(query);
                }
              }}
              placeholder="Rechercher un titre ou un artiste"
              className="h-8"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(query)}
            >
              <Search className="size-3.5" />
            </Button>
          </div>

          {result && !result.ok && (
            <p className="text-xs text-destructive">{result.error}</p>
          )}

          {result?.ok && (
            <p className="text-xs text-muted-foreground">
              {result.trending
                ? "Tendances du moment"
                : `${tracks.length} résultat${tracks.length > 1 ? "s" : ""}`}
              {pending && " — recherche…"}
            </p>
          )}

          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {tracks.map((track) => (
              <li key={track.audioId}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    onSelect({
                      audioId: track.audioId,
                      title: track.title,
                      artist:
                        track.artist ||
                        (track.creatorHandle ? `@${track.creatorHandle}` : ""),
                      // Par défaut on laisse Instagram fournir le son: c'est le
                      // cas qui apporte la découverte via la page de l'audio.
                      audioVolume: 100,
                      videoVolume: 0,
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect({
                        audioId: track.audioId,
                        title: track.title,
                        artist:
                          track.artist ||
                          (track.creatorHandle ? `@${track.creatorHandle}` : ""),
                        audioVolume: 100,
                        videoVolume: 0,
                      });
                    }
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    "hover:bg-accent",
                  )}
                >
                  <span className="truncate font-medium">{track.title}</span>
                  {/* Les sons originaux n'ont pas d'artiste: leur seule
                      identité est le compte qui les a créés, et sans lui une
                      liste de « Original audio » est indistinguable. */}
                  <span className="truncate text-xs text-muted-foreground">
                    {track.artist ||
                      (track.creatorHandle ? `@${track.creatorHandle}` : "")}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {duration(track.durationMs)}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      preview(track.audioId);
                    }}
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    title="Écouter"
                  >
                    <Play className="size-3" />
                  </button>
                </div>

                {playing?.audioId === track.audioId && (
                  <div className="px-2 pb-2">
                    {playing.playable ? (
                      <WaveformPlayer
                        src={`/api/instagram-audio/${channelAccountId}/${track.audioId}`}
                        onUnavailable={() =>
                          setPlaying((current) =>
                            current && current.audioId === track.audioId
                              ? { ...current, playable: false }
                              : current,
                          )
                        }
                      />
                    ) : playing.fallback ? (
                      <a
                        href={playing.fallback}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="size-3" />
                        Écoute impossible ici pour une piste sous licence — ouvrir sur
                        Instagram
                      </a>
                    ) : (
                      <p className="text-xs text-destructive">Piste indisponible.</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function VolumeSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="flex justify-between text-muted-foreground">
        {label}
        <span className="font-medium text-foreground">{value}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
    </label>
  );
}
