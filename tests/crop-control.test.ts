import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Le recadrage doit rester atteignable là où il se juge.
 *
 * La première version ne vivait que sur la fiche d'un média: en montant un
 * post, il fallait sortir du compositeur — et donc perdre sa sélection —
 * pour corriger une photo coupée. Ce test tient la présence du contrôle aux
 * deux endroits, et surtout le paramètre de version, sans lequel le
 * navigateur resservirait l'ancienne image sous la même URL.
 */

const COMPOSER = readFileSync("src/app/(app)/composer/composer-form.tsx", "utf8");
const VARIANT_LIST = readFileSync(
  "src/app/(app)/library/[assetId]/variant-list.tsx",
  "utf8",
);
const THUMB = readFileSync("src/components/media-thumb.tsx", "utf8");

describe("recadrage dans le compositeur", () => {
  it("le compositeur monte le contrôle de recadrage", () => {
    expect(COMPOSER).toContain("<CropControl");
    expect(COMPOSER).toMatch(/import \{ CropControl \} from "\.\/crop-control"/);
  });

  it("la fiche d'un média le propose aussi", () => {
    expect(VARIANT_LIST).toContain("deriveVariantAction");
    expect(VARIANT_LIST).toContain('type="range"');
  });

  it("toutes les vignettes du compositeur cassent leur cache après recadrage", () => {
    // Un Variant recadré garde son identifiant, donc son URL: sans `version`,
    // l'image affichée resterait celle d'avant.
    const versioned = [...COMPOSER.matchAll(/version=\{recropped\[/g)];
    const thumbs = [...COMPOSER.matchAll(/<MediaThumb/g)];
    expect(versioned.length).toBeGreaterThanOrEqual(thumbs.length);
  });

  it("la vignette sait tenir compte de cette version", () => {
    expect(THUMB).toMatch(/version \? `\/api\/media\/\$\{variantId\}\?v=\$\{version\}`/);
  });

  it("la version compte les recadrages, elle ne recopie pas le décalage", () => {
    // Recadrer tout en haut vaut 0, que le navigateur lit comme « pas de
    // paramètre »: l'image du cache reviendrait.
    expect(COMPOSER).toContain("version: (previous[variantId]?.version ?? 0) + 1");
  });
});
