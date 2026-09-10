/**
 * Conversion entre l'heure affichée et l'instant transmis.
 *
 * `<input type="datetime-local">` ne manipule que des heures murales, sans
 * fuseau. Transmettre sa valeur telle quelle laisse le serveur l'interpréter
 * dans **son** fuseau: sur une machine de développement réglée sur Paris, la
 * lecture tombait juste par accident; dans un conteneur en UTC, la même chaîne
 * décale chaque programmation de deux heures.
 *
 * Le navigateur est le seul à connaître le fuseau de l'opérateur: c'est donc
 * lui qui résout l'ambiguïté, et il envoie un instant, pas une heure murale.
 */

/** Valeur d'un `datetime-local`, au format que l'élément attend. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** L'instant désigné par une valeur `datetime-local`, en ISO avec fuseau. */
export function localInputToInstant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * Vrai si la chaîne porte un fuseau — `Z` ou `±hh:mm`.
 *
 * Le serveur s'en sert pour **refuser** une heure murale plutôt que de la
 * deviner: une programmation silencieusement décalée est pire qu'une erreur.
 */
export function hasTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
}
