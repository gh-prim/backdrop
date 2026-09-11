import { describe, it, expect } from "vitest";
import { clampOffset, cropFilter, RATIO_VALUES } from "../worker/activities/crop";

/**
 * Le recadrage est la seule étape qui jette des pixels définitivement.
 *
 * On vérifie ici la géométrie, pas ffmpeg: qu'un décalage reste dans l'image,
 * que 50 rende bien le centrage historique, et qu'un ratio inconnu échoue au
 * lieu de produire une chaîne de filtre silencieusement fausse.
 */

describe("clampOffset", () => {
  it("sans décalage, on retombe sur le centre", () => {
    expect(clampOffset(undefined)).toBe(50);
    expect(clampOffset(null)).toBe(50);
    expect(clampOffset(Number.NaN)).toBe(50);
  });

  it("un décalage hors bornes est ramené dans l'image", () => {
    expect(clampOffset(-40)).toBe(0);
    expect(clampOffset(140)).toBe(100);
  });

  it("un décalage fractionnaire devient entier", () => {
    expect(clampOffset(33.4)).toBe(33);
    expect(clampOffset(66.6)).toBe(67);
  });
});

describe("cropFilter", () => {
  it("50 % reproduit le cadrage centré", () => {
    const centre = cropFilter("4:5", 50);
    expect(centre).toContain("*0.5000");
    expect(centre).toBe(cropFilter("4:5"));
  });

  it("0 % garde le haut, 100 % garde le bas", () => {
    expect(cropFilter("4:5", 0)).toContain("*0.0000");
    expect(cropFilter("4:5", 100)).toContain("*1.0000");
  });

  it("le décalage est vertical: la largeur reste centrée", () => {
    for (const offset of [0, 50, 100]) {
      expect(cropFilter("9:16", offset)).toContain("(iw-min(iw,ih*0.5625))/2");
    }
  });

  it("la fenêtre ne sort jamais de l'image", () => {
    // `crop=w:h:x:y` avec y = (ih-h)*part: part ∈ [0,1] garde y+h ≤ ih.
    for (const ratio of Object.keys(RATIO_VALUES)) {
      for (const offset of [-10, 0, 37, 50, 100, 250]) {
        const part = clampOffset(offset) / 100;
        expect(part).toBeGreaterThanOrEqual(0);
        expect(part).toBeLessThanOrEqual(1);
        expect(cropFilter(ratio, offset)).toContain(`*${part.toFixed(4)}`);
      }
    }
  });

  it("la sortie est mise à l'échelle en 1080 de large", () => {
    expect(cropFilter("3:4", 20)).toContain("scale=1080:-2");
  });

  it("un ratio inconnu échoue au lieu de produire un filtre faux", () => {
    expect(() => cropFilter("16:9", 50)).toThrow(/Unsupported ratio/);
  });
});
