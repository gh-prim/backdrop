/** Constantes et types partagés serveur/client. Aucun import serveur ici. */

export const PERSONA_COOKIE = "backdrop.persona";

/** Valeur sentinelle du sélecteur: vue globale, toutes personas confondues. */
export const ALL_PERSONAS = "all";

export type PersonaOption = { id: string; name: string; handle: string };
