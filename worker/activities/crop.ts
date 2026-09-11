import { ApplicationFailure } from "@temporalio/activity";

/**
 * Géométrie du recadrage, isolée du reste de la dérivation.
 *
 * Rien ici ne touche au disque ni à la base: c'est du calcul de chaîne ffmpeg,
 * et c'est précisément la partie qui doit être vérifiable sans lancer ffmpeg.
 */

export const RATIO_VALUES: Record<string, number> = {
  "1:1": 1,
  // Le plus haut que le fil Instagram accepte depuis 2026: à partir d'un
  // master 1440x1920, il se publie sans rien perdre.
  "3:4": 3 / 4,
  "4:5": 4 / 5,
  "9:16": 9 / 16,
};

export const TARGET_WIDTH = 1080;

/** Un décalage hors bornes recadrerait hors de l'image: ffmpeg échouerait. */
export function clampOffset(offset?: number | null): number {
  if (offset === null || offset === undefined || Number.isNaN(offset)) return 50;
  return Math.min(100, Math.max(0, Math.round(offset)));
}

/**
 * Recadrage vers le ratio cible, puis mise à l'échelle.
 * `-2` sur la hauteur garantit un nombre pair, exigé par yuv420p.
 */
export function cropFilter(ratio: string, offset?: number | null): string {
  const value = RATIO_VALUES[ratio];
  if (!value) {
    throw ApplicationFailure.create({
      message: `Unsupported ratio: ${ratio}`,
      nonRetryable: true,
    });
  }

  const width = `min(iw,ih*${value})`;
  const height = `min(ih,iw/${value})`;

  // Sans décalage, ffmpeg centre — ce qui coupe autant en haut qu'en bas, et
  // décapite un sujet placé dans le tiers haut. Le décalage va de 0 (on garde
  // le haut) à 100 (on garde le bas); 50 revient au centre.
  const part = clampOffset(offset) / 100;
  const y = `(ih-${height})*${part.toFixed(4)}`;
  // Horizontalement, le cadrage reste centré: les formats visés sont tous plus
  // hauts que larges, la perte est verticale.
  const x = `(iw-${width})/2`;

  return `crop=${width}:${height}:${x}:${y},scale=${TARGET_WIDTH}:-2`;
}
