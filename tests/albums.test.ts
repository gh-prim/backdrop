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
import { albumRatios, listAlbums, resolveAlbum } from "@/lib/albums";
import { reduceAlbumPick } from "@/lib/albums-shared";

/**
 * L'album existe pour envoyer un lot d'un bloc, dans un cadrage choisi au
 * moment de l'envoi. Ce qui se teste ici est donc moins le CRUD que ce qui
 * décide de l'envoi: quels ratios sont proposables, ce qui est écarté, et ce
 * qu'un album ne doit jamais faire entrer dans une sélection.
 */
describe("albums", () => {
  let ctx: { organizationId: string; userId: string };
  let personaId: string;

  async function album(name: string, assetIds: string[]) {
    return prisma.album.create({
      data: {
        personaId,
        name,
        items: {
          create: assetIds.map((assetId, position) => ({ assetId, position })),
        },
      },
    });
  }

  beforeEach(async () => {
    await resetDatabase();
    const org = await createOrganization();
    const user = await createUser();
    const persona = await createPersona(org.id);
    personaId = persona.id;
    ctx = { organizationId: org.id, userId: user.id };
  });

  it("ne propose que les ratios que tous les médias possèdent", async () => {
    const complet = await createVariant(personaId, ctx.userId, Rating.SFW, ["4:5", "9:16"]);
    const partiel = await createVariant(personaId, ctx.userId, Rating.SFW, ["4:5"]);
    const created = await album("Vestiaire", [complet.assetId, partiel.assetId]);

    // 9:16 manque à l'un des deux: le proposer promettrait un carrousel que la
    // plateforme ne pourrait pas composer sans mélanger les cadrages.
    expect(await albumRatios(ctx as never, created.id)).toEqual(["4:5"]);
  });

  it("écarte et nomme les médias absents du ratio demandé", async () => {
    const complet = await createVariant(personaId, ctx.userId, Rating.SFW, ["4:5", "9:16"]);
    const partiel = await createVariant(personaId, ctx.userId, Rating.SFW, ["4:5"]);
    const created = await album("Vestiaire", [complet.assetId, partiel.assetId]);

    const resolved = await resolveAlbum(ctx as never, created.id, "9:16");
    expect(resolved?.variantIds).toHaveLength(1);
    expect(resolved?.missing).toHaveLength(1);
  });

  it("porte le rating le plus élevé de ses médias", async () => {
    const sage = await createVariant(personaId, ctx.userId, Rating.SFW);
    const cru = await createVariant(personaId, ctx.userId, Rating.NSFW);
    await album("Mélange", [sage.assetId, cru.assetId]);

    const [listed] = await listAlbums(ctx as never, personaId);
    // Sinon un média sensible se cacherait derrière une mosaïque anodine.
    expect(listed.rating).toBe("NSFW");
    expect(listed.count).toBe(2);
  });

  it("reste invisible depuis une autre organisation", async () => {
    const variant = await createVariant(personaId, ctx.userId, Rating.SFW);
    const created = await album("Vestiaire", [variant.assetId]);

    const autre = { organizationId: (await createOrganization("Autre")).id };
    expect(await listAlbums(autre as never)).toEqual([]);
    expect(await resolveAlbum(autre as never, created.id, "4:5")).toBeNull();
    expect(await albumRatios(autre as never, created.id)).toEqual([]);
  });
});

describe("réduction d'un album en sélection", () => {
  const ratings = { a: "SFW", b: "NSFW", c: "SUGGESTIVE" } as const;
  const ratingOf = (id: string) => ratings[id as keyof typeof ratings];

  it("retire ce qui dépasse le canal le plus restrictif", () => {
    // Le cœur du garde-fou: un album ignore les canaux, l'envoi non.
    const pick = reduceAlbumPick(["a", "b", "c"], ratingOf, "SFW", 10);
    expect(pick.kept).toEqual(["a"]);
    expect(pick.blocked).toBe(2);
  });

  it("plafonne le carrousel et compte le reste", () => {
    const pick = reduceAlbumPick(["a", "a", "a"], ratingOf, "NSFW", 2);
    expect(pick.kept).toHaveLength(2);
    expect(pick.overflow).toBe(1);
  });

  it("signale les variantes que le composeur ne connaît pas", () => {
    const pick = reduceAlbumPick(["a", "zzz"], ratingOf, "NSFW", 10);
    expect(pick.kept).toEqual(["a"]);
    expect(pick.unknown).toBe(1);
  });
});
