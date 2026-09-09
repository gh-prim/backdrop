import { describe, it, expect } from "vitest";
import { extractHashtags, MAX_HASHTAGS_PER_POST } from "@/lib/hashtags";

/**
 * Extraction des hashtags d'une légende (4.1.11).
 *
 * L'API n'a pas de champ dédié: tout se joue dans le texte, donc l'extraction
 * doit coller au comportement d'Instagram, pas à une approximation.
 */
describe("extraction des hashtags", () => {
  it("relève les hashtags simples", () => {
    expect(extractHashtags("Séance du matin #yoga #fitness")).toEqual(["yoga", "fitness"]);
  });

  it("normalise en minuscules et déduplique", () => {
    expect(extractHashtags("#Yoga #yoga #YOGA")).toEqual(["yoga"]);
  });

  it("accepte les accents, les chiffres et le tiret bas", () => {
    expect(extractHashtags("#été2026 #fit_girl #niçe06")).toEqual([
      "été2026",
      "fit_girl",
      "niçe06",
    ]);
  });

  it("ignore un croisillon collé à un mot", () => {
    // Instagram ne crée pas de hashtag là non plus.
    expect(extractHashtags("prix#yoga et no#tag")).toEqual([]);
  });

  it("relève un hashtag en début de légende", () => {
    expect(extractHashtags("#morning routine")).toEqual(["morning"]);
  });

  it("s'arrête à la ponctuation", () => {
    expect(extractHashtags("#yoga, #fitness. #calm!")).toEqual(["yoga", "fitness", "calm"]);
  });

  it("ne compte pas deux fois un hashtag répété pour le plafond", () => {
    const caption = Array.from({ length: 40 }, () => "#yoga").join(" ");
    expect(extractHashtags(caption)).toHaveLength(1);
  });

  it("expose le plafond d'Instagram", () => {
    expect(MAX_HASHTAGS_PER_POST).toBe(30);
  });
});
