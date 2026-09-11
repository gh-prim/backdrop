import { describe, it, expect } from "vitest";
import { lostPercent } from "@/app/(app)/composer/channel-framing";

/**
 * Ce que coûte un changement de cadrage.
 *
 * Le chiffre affiché à l'opérateur doit être le vrai: c'est lui qui décide
 * s'il envoie tel quel ou s'il reprend le média. Une estimation fausse serait
 * pire que pas d'estimation.
 */
describe("perte au recadrage", () => {
  it("chiffre la coupe d'un 9:16 ramené au fil Instagram", () => {
    // 9:16 = 0.5625, 4:5 = 0.8 → il reste 0.5625/0.8 = 70 % de l'image.
    expect(lostPercent("9:16", "4:5")).toBe(30);
    // Le 3:4 est plus haut que le 4:5: on y perd moins.
    expect(lostPercent("9:16", "3:4")).toBe(25);
  });

  it("ne perd rien quand le cadrage est le même", () => {
    expect(lostPercent("4:5", "4:5")).toBe(0);
    expect(lostPercent("9:16", "9:16")).toBe(0);
  });

  it("compte aussi la perte dans l'autre sens", () => {
    // Un 4:5 affiché en 9:16 perd de la largeur, pas de la hauteur.
    expect(lostPercent("4:5", "9:16")).toBe(30);
  });

  it("rend zéro sur un cadrage inconnu, plutôt qu'un chiffre inventé", () => {
    expect(lostPercent("21:9", "4:5")).toBe(0);
  });
});
