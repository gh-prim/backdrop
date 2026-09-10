import { describe, expect, it } from "vitest";
import { captionWithHashtags, totalHashtags } from "@/lib/hashtags";
import { HASHTAG_LIMIT, MAX_HASHTAGS_PER_POST } from "@/lib/hashtags-shared";

/**
 * Les hashtags ne se tapent plus dans la légende: elle est commune à tout
 * l'envoi, et Telegram n'a rien à faire d'une traîne de croisillons. Ils sont
 * choisis dans l'onglet Instagram et concaténés ici — l'API n'ayant pas de
 * champ dédié, ils doivent bien finir dans la légende (4.1.11).
 */
describe("captionWithHashtags", () => {
  it("laisse la légende intacte quand aucun hashtag n'est choisi", () => {
    expect(captionWithHashtags("Séance du matin", [])).toBe("Séance du matin");
  });

  it("sépare les hashtags de la légende par une ligne vide", () => {
    expect(captionWithHashtags("Séance du matin", ["yoga", "fitness"])).toBe(
      "Séance du matin\n\n#yoga #fitness",
    );
  });

  it("n'ouvre pas la légende par une ligne vide quand elle est absente", () => {
    // Une légende vide suivie de deux sauts de ligne pousserait les hashtags
    // vers le bas du post pour rien.
    expect(captionWithHashtags("", ["yoga"])).toBe("#yoga");
    expect(captionWithHashtags("   ", ["yoga"])).toBe("#yoga");
  });

  it("supprime les blancs de fin avant de concaténer", () => {
    expect(captionWithHashtags("Séance  \n\n", ["yoga"])).toBe("Séance\n\n#yoga");
  });
});

describe("plafond de 30 hashtags", () => {
  it("ne compte pas deux fois un hashtag déjà tapé dans la légende", () => {
    // Le dupliquer le ferait compter deux fois dans le plafond, pour rien.
    expect(totalHashtags("Séance #yoga", ["yoga", "fitness"])).toBe(2);
    expect(captionWithHashtags("Séance #yoga", ["yoga", "fitness"])).toBe(
      "Séance #yoga\n\n#fitness",
    );
  });

  it("additionne ce qui est tapé et ce qui est choisi", () => {
    // Compter les seuls hashtags choisis laisserait passer un dépassement
    // qu'Instagram refuse à l'envoi (erreur 100/2207040).
    expect(totalHashtags("#a #b #c", ["d", "e"])).toBe(5);
  });

  it("détecte le dépassement du plafond documenté", () => {
    const picked = Array.from({ length: MAX_HASHTAGS_PER_POST }, (_, i) => `tag${i}`);
    expect(totalHashtags("", picked)).toBe(MAX_HASHTAGS_PER_POST);
    expect(totalHashtags("#extra", picked)).toBe(MAX_HASHTAGS_PER_POST + 1);
  });
});

describe("règle maison: trois hashtags", () => {
  it("reste bien en deçà du plafond d'Instagram", () => {
    // Deux notions distinctes: 30 est un fait sur Instagram et son code
    // d'erreur, 3 est un choix éditorial. Les confondre ferait perdre la
    // raison de chacun.
    expect(HASHTAG_LIMIT).toBeLessThan(MAX_HASHTAGS_PER_POST);
    expect(HASHTAG_LIMIT).toBe(3);
  });

  it("compte les hashtags tapés dans la légende dans la même limite", () => {
    expect(totalHashtags("#a #b", ["c"])).toBe(3);
    expect(totalHashtags("#a #b", ["c", "d"])).toBeGreaterThan(HASHTAG_LIMIT);
  });
});
