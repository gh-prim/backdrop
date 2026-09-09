"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Loader2, Pause, Play } from "lucide-react";
import { cn } from "cn";

/**
 * Lecteur à forme d'onde.
 *
 * Les octets arrivent par le relais applicatif et non depuis le CDN de Meta:
 * le décodage nécessaire au tracé exige une ressource de même origine.
 */
export function WaveformPlayer({
  src,
  onUnavailable,
  className,
}: {
  src: string;
  onUnavailable?: () => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!container.current) return;

    const instance = WaveSurfer.create({
      container: container.current,
      height: 40,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      cursorWidth: 1,
      // Les couleurs sont lues sur les tokens du thème: le lecteur suit la
      // palette au lieu de la contredire.
      waveColor: "oklch(0.55 0 0)",
      progressColor: "oklch(0.87 0 0)",
      cursorColor: "oklch(0.87 0 0)",
      normalize: true,
      url: src,
    });

    wavesurfer.current = instance;

    instance.on("ready", () => {
      setReady(true);
      setDuration(instance.getDuration());
      void instance.play();
    });
    instance.on("play", () => setPlaying(true));
    instance.on("pause", () => setPlaying(false));
    instance.on("finish", () => setPlaying(false));
    instance.on("timeupdate", (time) => setPosition(time));
    instance.on("error", () => onUnavailable?.());

    return () => {
      instance.destroy();
      wavesurfer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  function format(seconds: number) {
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        disabled={!ready}
        onClick={() => void wavesurfer.current?.playPause()}
        className="flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors hover:bg-accent disabled:opacity-50"
      >
        {!ready ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : playing ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5" />
        )}
      </button>

      <div ref={container} className="min-w-0 flex-1" />

      <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {format(position)} / {format(duration)}
      </span>
    </div>
  );
}
