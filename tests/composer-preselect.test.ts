import { describe, it, expect, beforeEach } from "vitest";
import { Rating } from "@prisma/client";
import {
  prisma,
  resetDatabase,
  createOrganization,
  createUser,
  createPersona,
  createVariant,
} from "./helpers";
import { resolvePreselection } from "@/lib/composer-preselect";

/**
 * Ouvrir le composeur depuis la bibliothèque.
 *
 * L'identifiant vient d'une URL: il ne dit rien du droit de le voir. La
 * résolution est donc serveur et contrainte à l'organisation de la session
 * (9.6) — un média d'ailleurs doit être traité comme inexistant, pas comme
 * une erreur qui en révélerait l'existence.
 */
describe("pré-sélection du composeur", () => {
  let ctx: { organizationId: string };
  let userId: string;
  let personaId: string;

  beforeEach(async () => {
    await resetDatabase();
    const org = await createOrganization();
    const user = await createUser();
    const persona = await createPersona(org.id);
    userId = user.id;
    personaId = persona.id;
    ctx = { organizationId: org.id };
  });

  it("ouvre sur un média, dans le ratio demandé", async () => {
    const variant = await createVariant(personaId, userId, Rating.SFW, ["4:5", "9:16"]);
    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: variant.assetId },
      select: { id: true, variants: { where: { ratio: "9:16" }, select: { id: true } } },
    });

    const choix = await resolvePreselection(ctx as never, {
      assetId: asset.id,
      ratio: "9:16",
    });
    expect(choix.variantIds).toEqual([asset.variants[0].id]);
    expect(choix.label).toContain("9:16");
  });

  it("retombe sur un cadrage existant quand celui demandé manque", async () => {
    const variant = await createVariant(personaId, userId, Rating.SFW, ["4:5"]);
    const choix = await resolvePreselection(ctx as never, {
      assetId: variant.assetId,
      ratio: "1:1",
    });
    expect(choix.variantIds).toHaveLength(1);
  });

  it("ouvre sur un album entier, dans un ratio que tous ses médias ont", async () => {
    const complet = await createVariant(personaId, userId, Rating.SFW, ["4:5", "9:16"]);
    const partiel = await createVariant(personaId, userId, Rating.SFW, ["4:5"]);
    const album = await prisma.album.create({
      data: {
        personaId,
        name: "Vestiaire",
        items: {
          create: [
            { assetId: complet.assetId, position: 0 },
            { assetId: partiel.assetId, position: 1 },
          ],
        },
      },
    });

    const choix = await resolvePreselection(ctx as never, { albumId: album.id });
    // 9:16 manque à l'un des deux: seul 4:5 part entier.
    expect(choix.variantIds).toHaveLength(2);
    expect(choix.label).toContain("4:5");
    expect(choix.missing).toBe(0);
  });

  it("ne rend rien pour un média d'une autre organisation", async () => {
    const variant = await createVariant(personaId, userId, Rating.SFW);
    const autre = { organizationId: (await createOrganization("Autre")).id };

    const choix = await resolvePreselection(autre as never, { assetId: variant.assetId });
    expect(choix.variantIds).toEqual([]);
    expect(choix.label).toBeNull();
  });
});
