"use client";

import { MediaThumb } from "@/components/media-thumb";
import { PlatformLogo } from "@/components/platform-logo";
import { INSTAGRAM_FEED_RATIOS } from "@/lib/channels/instagram";

type Platform = "INSTAGRAM" | "TELEGRAM" | "FANVUE";

const RATIO_VALUE: Record<string, number> = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:5": 4 / 5,
  "9:16": 9 / 16,
};

/** Le cadre le plus haut que le fil Instagram accepte. */
const FEED_TALLEST = INSTAGRAM_FEED_RATIOS.reduce((tallest, ratio) =>
  RATIO_VALUE[ratio] < RATIO_VALUE[tallest] ? ratio : tallest,
);

/**
 * Ce que chaque canal affichera réellement.
 *
 * Une photo coupée se découvre aujourd'hui une fois publiée. Le recadrage est
 * pourtant prévisible: Instagram ramène au plus haut de son fil, les autres
 * canaux montrent l'image telle quelle. Autant le donner à voir avant l'envoi
 * — c'est la surprise qui coûte, pas le recadrage.
 */
export function ChannelFraming({
  variant,
  platforms,
  kind,
  version,
}: {
  variant: { id: string; ratio: string; rating: string };
  platforms: Platform[];
  kind: string;
  /** Incrémentée après un recadrage: l'URL du média, elle, ne change pas. */
  version?: number;
}) {
  if (platforms.length === 0) return null;

  const frames = platforms.map((platform) => framing(platform, variant.ratio, kind));

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        What each channel will show — the dimmed part is cropped away.
      </p>

      <div className="flex flex-wrap gap-3">
        {frames.map((frame) => (
          <div key={frame.platform} className="space-y-1">
            <div
              className="relative overflow-hidden rounded-md"
              style={{ width: 96, aspectRatio: frame.ratio.replace(":", " / ") }}
            >
              {/* `cover` recadre au centre, exactement comme ffmpeg côté
                  worker: l'aperçu ne promet donc rien d'autre que ce qui
                  partira. */}
              <MediaThumb
                variantId={variant.id}
                rating={variant.rating as "SFW" | "SUGGESTIVE" | "NSFW"}
                className="size-full [&_img]:object-cover"
                version={version}
              />
            </div>

            <p className="flex items-center gap-1 text-[11px]">
              <PlatformLogo platform={frame.platform} className="size-3.5" />
              {frame.ratio}
            </p>

            <p
              className={
                frame.lostPercent > 0
                  ? "text-[11px] text-destructive"
                  : "text-[11px] text-muted-foreground"
              }
            >
              {frame.lostPercent > 0
                ? `${frame.lostPercent}% cropped`
                : "shown in full"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function framing(platform: Platform, ratio: string, kind: string) {
  // Instagram est le seul à imposer un cadre: Telegram et Fanvue affichent le
  // média tel qu'il est envoyé.
  if (platform !== "INSTAGRAM") {
    return { platform, ratio, lostPercent: 0 };
  }

  const target = kind === "REEL" ? "9:16" : FEED_TALLEST;
  return { platform, ratio: target, lostPercent: lostPercent(ratio, target) };
}

/**
 * Part de l'image perdue en passant d'un cadrage à l'autre.
 *
 * Un média plus haut que le cadre perd de la hauteur; plus large, de la
 * largeur. Dans les deux cas c'est le rapport des rapports.
 */
export function lostPercent(from: string, to: string): number {
  const source = RATIO_VALUE[from];
  const frame = RATIO_VALUE[to];
  if (!source || !frame || source === frame) return 0;

  const kept = source < frame ? source / frame : frame / source;
  return Math.round((1 - kept) * 100);
}
