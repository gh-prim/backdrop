import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Garde structurel du composeur.
 *
 * Le formulaire est un assistant: **une étape quittée est démontée**, et un
 * champ qui n'existe plus au moment de la soumission n'est pas envoyé. Tout
 * ce que l'action attend doit donc être réémis dans le bloc toujours monté,
 * pas seulement affiché dans son étape.
 *
 * Ce défaut a coûté deux fois: la destination Telegram, puis la légende — un
 * post Fanvue publié sans une ligne de texte, sans la moindre erreur nulle
 * part. Le voir en test plutôt qu'en production est tout l'objet de ce
 * fichier.
 */

const SOURCE = readFileSync("src/app/(app)/composer/composer-form.tsx", "utf8");

/** La partie du formulaire rendue quelle que soit l'étape courante. */
function alwaysMounted(): string {
  const start = SOURCE.indexOf("<form action={action}");
  const firstStep = SOURCE.indexOf("{currentStep.key ===", start);
  expect(start).toBeGreaterThan(-1);
  expect(firstStep).toBeGreaterThan(start);
  return SOURCE.slice(start, firstStep);
}

describe("champs du composeur", () => {
  it("réémet hors des étapes tout ce que l'action lit", () => {
    const bloc = alwaysMounted();
    for (const champ of ["kind", "name", "caption", "scheduledAt", "variantIds"]) {
      expect(bloc, `champ « ${champ} » absent du bloc toujours monté`).toContain(
        `name="${champ}"`,
      );
    }
  });

  it("réémet aussi le cadrage par canal", () => {
    // L'écran de confirmation est une étape comme une autre: la quitter le
    // démonte. Sans ces champs dans le bloc permanent, chaque canal
    // retomberait silencieusement sur la sélection de base — c'est-à-dire
    // exactement le recadrage au hasard qu'on cherche à supprimer.
    expect(alwaysMounted()).toContain("name={`channelVariantIds:${channelId}`}");
  });

  it("ne laisse aucun champ nommé dans une étape", () => {
    const debutEtapes = SOURCE.indexOf("{currentStep.key ===");
    const etapes = SOURCE.slice(debutEtapes);
    // Les champs des étapes pilotent l'état React; ils ne doivent jamais
    // porter un `name`, sous peine d'être soumis « parfois ».
    const nommes = [...etapes.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(nommes).toEqual([]);
  });
});
