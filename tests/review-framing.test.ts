import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  defaultFraming,
  ratiosFor,
} from "@/app/(app)/composer/review-step";

/**
 * Le cadre que chaque canal reçoit par défaut.
 *
 * C'est le réglage que personne ne touchera: il doit être le bon sans
 * intervention. Un 9:16 envoyé au fil Instagram s'y fait recouper au centre —
 * la plainte d'origine, « mes photos sont coupées en haut et en bas ».
 */

const media = (ratio: string, cropOffset: number | null = null) => ({
  variantId: "v1",
  assetId: "a1",
  ratio,
  rating: "SFW" as const,
  cropOffset,
});

describe("cadres proposés par canal", () => {
  it("Instagram n'offre que ce que son fil accepte", () => {
    const feed = ratiosFor("INSTAGRAM", "POST");
    expect(feed).toContain("4:5");
    expect(feed).toContain("3:4");
    // Le 9:16 appartient aux Reels: l'offrir pour le fil reviendrait à
    // proposer un cadrage qu'Instagram recouperait derrière notre dos.
    expect(feed).not.toContain("9:16");
  });

  it("un Reel, lui, est vertical et rien d'autre", () => {
    expect(ratiosFor("INSTAGRAM", "REEL")).toEqual(["9:16"]);
  });

  it("Telegram et Fanvue affichent ce qu'on leur envoie", () => {
    for (const platform of ["TELEGRAM", "FANVUE"] as const) {
      expect(ratiosFor(platform, "POST")).toContain("9:16");
      expect(ratiosFor(platform, "POST")).toContain("1:1");
    }
  });
});

describe("cadre par défaut", () => {
  it("ramène un 9:16 au plus haut du fil Instagram, pas au centre du 4:5", () => {
    // 3:4 est plus haut que 4:5: c'est celui qui coupe le moins.
    expect(defaultFraming("INSTAGRAM", "POST", media("9:16")).ratio).toBe("3:4");
  });

  it("laisse le média tel quel quand le canal l'accepte", () => {
    expect(defaultFraming("INSTAGRAM", "POST", media("4:5")).ratio).toBe("4:5");
    expect(defaultFraming("TELEGRAM", "POST", media("9:16")).ratio).toBe("9:16");
  });

  it("reprend le point de coupe déjà choisi sur le média", () => {
    expect(defaultFraming("TELEGRAM", "POST", media("9:16", 20)).cropOffset).toBe(20);
    // Sans réglage, le centre — le comportement historique.
    expect(defaultFraming("TELEGRAM", "POST", media("9:16")).cropOffset).toBe(50);
  });

  it("ne propose jamais un cadre que la dérivation ignore", () => {
    const derivables = readFileSync("worker/activities/crop.ts", "utf8");
    for (const platform of ["INSTAGRAM", "TELEGRAM", "FANVUE"] as const) {
      for (const kind of ["POST", "CAROUSEL", "REEL"]) {
        for (const ratio of ratiosFor(platform, kind)) {
          expect(derivables, `${ratio} non dérivable`).toContain(`"${ratio}"`);
        }
      }
    }
  });
});
