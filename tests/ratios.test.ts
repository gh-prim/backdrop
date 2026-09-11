import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { INSTAGRAM_FEED_RATIOS, INSTAGRAM_REEL_RATIOS } from "@/lib/channels/instagram";

/**
 * Les cadrages proposés doivent exister dans le pipeline.
 *
 * Offrir à l'écran un ratio que la dérivation ne sait pas produire fabrique
 * une publication sans média: l'erreur ne se voit qu'au moment de l'envoi,
 * très loin du choix.
 */
const MEDIA = readFileSync("worker/activities/crop.ts", "utf8");

function ratiosDerivables(): string[] {
  const bloc = MEDIA.slice(
    MEDIA.indexOf("RATIO_VALUES"),
    MEDIA.indexOf("TARGET_WIDTH"),
  );
  return [...bloc.matchAll(/"([0-9]+:[0-9]+)"/g)].map((m) => m[1]);
}

describe("cadrages", () => {
  it("tout ce qu'Instagram accepte est dérivable", () => {
    const derivables = ratiosDerivables();
    for (const ratio of [...INSTAGRAM_FEED_RATIOS, ...INSTAGRAM_REEL_RATIOS]) {
      expect(derivables, `ratio ${ratio} non dérivable`).toContain(ratio);
    }
  });

  it("les écrans ne proposent que des cadrages dérivables", () => {
    const derivables = ratiosDerivables();
    for (const fichier of [
      "src/app/(app)/library/upload-form.tsx",
      "src/app/(app)/library/[assetId]/variant-list.tsx",
    ]) {
      const source = readFileSync(fichier, "utf8");
      const ligne = source.split("\n").find((l) => /RATIOS = \[/.test(l)) ?? "";
      const proposes = [...ligne.matchAll(/"([0-9]+:[0-9]+)"/g)].map((m) => m[1]);
      expect(proposes.length).toBeGreaterThan(0);
      for (const ratio of proposes) {
        expect(derivables, `${fichier} propose ${ratio}`).toContain(ratio);
      }
    }
  });

  it("le 9:16 n'appartient pas au fil", () => {
    // C'est la distinction qui évite une photo rognée en haut et en bas.
    expect(INSTAGRAM_FEED_RATIOS).not.toContain("9:16");
    expect(INSTAGRAM_REEL_RATIOS).toContain("9:16");
  });
});
