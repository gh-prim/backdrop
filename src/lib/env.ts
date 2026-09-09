/**
 * Lecture de variables d'environnement.
 *
 * Docker Compose transmet une variable non définie comme **chaîne vide**, pas
 * comme absente. `process.env.X ?? défaut` laisse donc passer la chaîne vide,
 * et le défaut ne s'applique jamais. Ce piège a coûté deux pannes: un client
 * S3 jamais construit, puis des URL Graph relatives — les deux muettes sur la
 * cause réelle.
 *
 * Ces fonctions traitent la chaîne vide, et les espaces seuls, comme une
 * absence. Les utiliser partout plutôt que `??` sur `process.env`.
 */

export function envOr(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export function envOrNull(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function envNumberOr(name: string, fallback: number): number {
  // `Number("")` vaut 0, pas NaN: tester la chaîne d'abord, sinon une variable
  // vide donnerait zéro. Sur SCHEDULE_TOLERANCE_MINUTES, cela ferait passer
  // toute publication en MISSED.
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
