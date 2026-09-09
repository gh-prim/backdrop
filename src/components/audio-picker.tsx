"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Music, Search, X } from "lucide-react";
import {
  searchInstagramAudioAction,
  type AudioSearchResult,
} from "@/app/actions/audio";
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
  const [result, setResult] = useState<AudioSearchResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run(nextQuery: string) {
    startTransition(async () => {
      setResult(await searchInstagramAudioAction(channelAccountId, nextQuery));
    });
  }

  // Tendances au chargement: un champ de recherche vide n'aide personne.
  useEffect(() => {
    run("");
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
                      artist: track.artist,
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
                        artist: track.artist,
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
                  <span className="truncate text-xs text-muted-foreground">
                    {track.artist}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {duration(track.durationMs)}
                  </span>
                  {track.previewUrl && (
                    <a
                      href={track.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      écouter
                    </a>
                  )}
                </div>
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
