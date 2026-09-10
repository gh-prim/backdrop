/**
 * Réduction d'un album en sélection de médias.
 *
 * Isolé du composant parce que c'est ici que se joue le garde-fou: un album
 * ignore les canaux, et rien n'empêche d'y ranger un média plus explicite que
 * ce que le plus restrictif des canaux choisis accepte. Le filtre doit donc
 * être testable seul, pas seulement observable à l'écran.
 */
export type AlbumRating = "SFW" | "SUGGESTIVE" | "NSFW";

const RANK: Record<AlbumRating, number> = { SFW: 0, SUGGESTIVE: 1, NSFW: 2 };

export type AlbumPick = {
  /** Variantes retenues, dans l'ordre de l'album. */
  kept: string[];
  /** Écartées parce que trop explicites pour le canal le plus restrictif. */
  blocked: number;
  /** Écartées parce qu'au-delà du plafond du carrousel. */
  overflow: number;
  /** Inconnues de cette persona: aucune variante publiable dérivée. */
  unknown: number;
};

export function reduceAlbumPick(
  variantIds: string[],
  ratingOf: (id: string) => AlbumRating | undefined,
  allowedRating: AlbumRating,
  limit: number,
): AlbumPick {
  const known = variantIds.filter((id) => ratingOf(id) !== undefined);
  const allowed = known.filter((id) => RANK[ratingOf(id)!] <= RANK[allowedRating]);
  const kept = allowed.slice(0, limit);

  return {
    kept,
    blocked: known.length - allowed.length,
    overflow: allowed.length - kept.length,
    unknown: variantIds.length - known.length,
  };
}
