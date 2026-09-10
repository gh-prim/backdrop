/**
 * Règles de hashtags utilisables des deux côtés.
 *
 * `src/lib/hashtags.ts` porte `server-only` parce qu'il touche la base; ces
 * deux-là sont de la pure logique et le composant de sélection en a besoin.
 */

/**
 * Plafond d'Instagram sur une publication, vérifié dans la documentation:
 * au-delà, l'API renvoie l'erreur `100 / 2207040` et refuse la publication —
 * elle n'ignore pas silencieusement le surplus.
 */
export const MAX_HASHTAGS_PER_POST = 30;

/**
 * Extrait les hashtags d'une légende.
 *
 * Instagram accepte lettres, chiffres et tiret bas, y compris accentués. Un
 * croisillon collé à un mot précédent ne compte pas: `mot#tag` n'est pas un
 * hashtag pour Instagram non plus.
 */
export function extractHashtags(caption: string): string[] {
  const matches = caption.match(/(?:^|[\s.,;:!?()[\]{}"'—–-])#([\p{L}\p{N}_]+)/gu) ?? [];
  const names = matches.map((raw) => raw.slice(raw.indexOf("#") + 1).toLowerCase());
  return [...new Set(names)];
}
