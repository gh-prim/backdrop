/**
 * Le compte de non-lus, tel qu'on l'affiche.
 *
 * Au-delà de dix, le chiffre exact n'apprend plus rien: on sait qu'il y en a
 * beaucoup, et c'est la seule décision qu'il commande. Le tronquer garde aussi
 * la pastille à une largeur constante, ce qui l'empêche de faire sauter la
 * navigation à chaque message reçu.
 *
 * Module à part et sans `server-only`: la barre est rendue côté serveur, la
 * liste des fils côté client, et les deux doivent afficher le même chiffre.
 */
export function unreadLabel(count: number): string {
  return count > 10 ? "10+" : String(count);
}
