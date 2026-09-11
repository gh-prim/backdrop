/**
 * La version de l'applicatif, affichée en bas à gauche de chaque écran.
 *
 * Elle existe pour une raison précise: le 2026-09-11, une construction Docker
 * a échoué par manque de place **après** que `git pull` eut avancé le dépôt.
 * Le fichier était donc à jour sur le serveur, l'image non, et rien à l'écran
 * ne distinguait « déployé » de « supposé déployé ». Une version visible rend
 * la question vérifiable en une seconde, sans ouvrir un terminal.
 *
 * Semver, et la faire monter à chaque fonctionnalité: une version qui ne
 * bouge pas ne prouve rien.
 *
 * Tant que la phase 1 n'est pas close, on reste en 0.x — le majeur passera à
 * 1 quand l'outil sera tenu pour stable, pas avant.
 */
export const APP_VERSION = "0.6.0";
