import { envOr } from "@/lib/env";

/**
 * Origine publique de l'instance, vue depuis un navigateur.
 *
 * `request.url` ne la donne pas derrière un proxy: le serveur Next écoute sur
 * `0.0.0.0:3000` dans son conteneur, et c'est cette adresse qu'il recopie. Un
 * retour d'OAuth construit dessus renvoie l'opérateur sur
 * `https://0.0.0.0:3000`, qui n'existe nulle part.
 *
 * Trois sources, dans l'ordre: la configuration explicite, ce que le proxy
 * annonce, puis la requête elle-même en dernier recours.
 */
export function publicOrigin(request: Request): string {
  const configured = envOr("PUBLIC_BASE_URL", envOr("BETTER_AUTH_URL", ""));
  if (configured) return configured.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const protocol = request.headers.get("x-forwarded-proto") ?? "https";
    return `${protocol}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}
