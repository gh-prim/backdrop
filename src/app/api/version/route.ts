import { APP_VERSION } from "@/lib/version";

/**
 * La version réellement servie.
 *
 * Sans authentification, et c'est délibéré: le point d'entrée existe pour que
 * `update.sh` vérifie son propre travail, et une vérification qui suppose une
 * session ne vérifierait plus rien en automatique. Il ne rend qu'une chaîne de
 * version — pas de configuration, pas d'état, rien qui renseigne sur le
 * contenu de l'instance.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ version: APP_VERSION });
}
