import { describe, it, expect } from "vitest";
import { hasTimezone, localInputToInstant, toLocalInput } from "@/lib/schedule-time";

/**
 * Régression trouvée en conteneur: le formulaire envoyait l'heure murale du
 * champ `datetime-local`, que le serveur interprétait dans **son** fuseau.
 * Sur une machine de développement réglée sur Paris, la lecture tombait juste
 * par accident; en conteneur (UTC), toute programmation partait deux heures
 * trop tard.
 */
describe("heure programmée", () => {
  it("traduit l'heure murale en instant", () => {
    const iso = localInputToInstant("2026-09-10T17:18");
    // Quel que soit le fuseau du test, l'instant doit être celui que
    // l'opérateur voit à l'écran.
    expect(new Date(iso).getHours()).toBe(17);
    expect(new Date(iso).getMinutes()).toBe(18);
    expect(hasTimezone(iso)).toBe(true);
  });

  it("fait l'aller-retour sans dériver", () => {
    const midi = new Date();
    midi.setSeconds(0, 0);
    expect(localInputToInstant(toLocalInput(midi))).toBe(midi.toISOString());
  });

  it("reconnaît une heure murale, qui n'a pas de fuseau", () => {
    expect(hasTimezone("2026-09-10T17:18")).toBe(false);
    expect(hasTimezone("2026-09-10T15:18:00.000Z")).toBe(true);
    expect(hasTimezone("2026-09-10T17:18:00+02:00")).toBe(true);
  });

  it("ne fabrique rien à partir d'une valeur vide", () => {
    expect(localInputToInstant("")).toBe("");
    expect(localInputToInstant("pas une date")).toBe("");
  });
});
