import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Platform, Rating } from "@prisma/client";
import {
  prisma,
  resetDatabase,
  createOrganization,
  createUser,
  createPersona,
  createChannel,
  createVariant,
  createPublication,
} from "./helpers";

/**
 * Objectif 2 du spec: rendre impossible la publication de contenu NSFW sur
 * Instagram. Ces tests ciblent la couche base de données, la seule qui tienne
 * même en cas de bug applicatif (9.1).
 */
describe("garde-fou de rating en base", () => {
  let userId: string;
  let personaId: string;

  beforeEach(async () => {
    await resetDatabase();
    const org = await createOrganization();
    const user = await createUser();
    const persona = await createPersona(org.id);
    userId = user.id;
    personaId = persona.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejette un Asset NSFW vers un canal Instagram limité à SFW", async () => {
    const channel = await createChannel(personaId, Platform.INSTAGRAM, Rating.SFW);
    const publication = await createPublication(channel.id, userId);
    const variant = await createVariant(personaId, userId, Rating.NSFW);

    await expect(
      prisma.publicationItem.create({
        data: { publicationId: publication.id, variantId: variant.id, position: 0 },
      }),
    ).rejects.toThrow(/rating_violation/);

    expect(await prisma.publicationItem.count()).toBe(0);
  });

  it("rejette un SUGGESTIVE vers Instagram, pas seulement le NSFW", async () => {
    const channel = await createChannel(personaId, Platform.INSTAGRAM, Rating.SFW);
    const publication = await createPublication(channel.id, userId);
    const variant = await createVariant(personaId, userId, Rating.SUGGESTIVE);

    await expect(
      prisma.publicationItem.create({
        data: { publicationId: publication.id, variantId: variant.id, position: 0 },
      }),
    ).rejects.toThrow(/rating_violation/);
  });

  it("accepte un Asset SFW vers Instagram", async () => {
    const channel = await createChannel(personaId, Platform.INSTAGRAM, Rating.SFW);
    const publication = await createPublication(channel.id, userId);
    const variant = await createVariant(personaId, userId, Rating.SFW);

    const item = await prisma.publicationItem.create({
      data: { publicationId: publication.id, variantId: variant.id, position: 0 },
    });
    expect(item.id).toBeTruthy();
  });

  it("accepte un Asset NSFW vers un canal Telegram qui l'autorise", async () => {
    const channel = await createChannel(personaId, Platform.TELEGRAM, Rating.NSFW);
    const publication = await createPublication(channel.id, userId);
    const variant = await createVariant(personaId, userId, Rating.NSFW);

    const item = await prisma.publicationItem.create({
      data: { publicationId: publication.id, variantId: variant.id, position: 0 },
    });
    expect(item.id).toBeTruthy();
  });

  // Le cas nommé explicitement par le spec (section 8).
  it("rejette un carrousel dont un seul élément sur dix est NSFW", async () => {
    const channel = await createChannel(personaId, Platform.INSTAGRAM, Rating.SFW);
    const publication = await createPublication(channel.id, userId, "CAROUSEL");

    for (let position = 0; position < 9; position++) {
      const sfw = await createVariant(personaId, userId, Rating.SFW);
      await prisma.publicationItem.create({
        data: { publicationId: publication.id, variantId: sfw.id, position },
      });
    }

    const nsfw = await createVariant(personaId, userId, Rating.NSFW);
    await expect(
      prisma.publicationItem.create({
        data: { publicationId: publication.id, variantId: nsfw.id, position: 9 },
      }),
    ).rejects.toThrow(/rating_violation/);

    expect(await prisma.publicationItem.count()).toBe(9);
  });

  it("rejette la mise à jour d'un item vers un Variant NSFW", async () => {
    const channel = await createChannel(personaId, Platform.INSTAGRAM, Rating.SFW);
    const publication = await createPublication(channel.id, userId);
    const sfw = await createVariant(personaId, userId, Rating.SFW);
    const nsfw = await createVariant(personaId, userId, Rating.NSFW);

    const item = await prisma.publicationItem.create({
      data: { publicationId: publication.id, variantId: sfw.id, position: 0 },
    });

    await expect(
      prisma.publicationItem.update({
        where: { id: item.id },
        data: { variantId: nsfw.id },
      }),
    ).rejects.toThrow(/rating_violation/);
  });

  // Le rating devient modifiable (9.4): la garantie doit rester à la base.
  it("rejette le reclassement d'un Asset utilisé par une publication Instagram", async () => {
    const channel = await createChannel(personaId, Platform.INSTAGRAM, Rating.SFW);
    const publication = await createPublication(channel.id, userId);
    const variant = await createVariant(personaId, userId, Rating.SFW);

    await prisma.publicationItem.create({
      data: { publicationId: publication.id, variantId: variant.id, position: 0 },
    });

    const asset = await prisma.variant.findUniqueOrThrow({
      where: { id: variant.id },
      select: { assetId: true },
    });

    // Le trigger sur PublicationItem ne se déclenche pas ici: c'est celui sur
    // Asset qui doit refuser, sinon reclasser après coup contournerait tout.
    await expect(
      prisma.asset.update({
        where: { id: asset.assetId },
        data: { rating: Rating.NSFW },
      }),
    ).rejects.toThrow(/rating_violation/);

    const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.assetId } });
    expect(after.rating).toBe(Rating.SFW);
  });

  it("accepte le reclassement d'un Asset qu'aucune publication n'utilise", async () => {
    const variant = await createVariant(personaId, userId, Rating.SFW);
    const asset = await prisma.variant.findUniqueOrThrow({
      where: { id: variant.id },
      select: { assetId: true },
    });

    const updated = await prisma.asset.update({
      where: { id: asset.assetId },
      data: { rating: Rating.NSFW },
    });
    expect(updated.rating).toBe(Rating.NSFW);
  });

  it("accepte le reclassement vers un rating que le canal autorise", async () => {
    const channel = await createChannel(personaId, Platform.TELEGRAM, Rating.NSFW);
    const publication = await createPublication(channel.id, userId);
    const variant = await createVariant(personaId, userId, Rating.SFW);
    await prisma.publicationItem.create({
      data: { publicationId: publication.id, variantId: variant.id, position: 0 },
    });
    const asset = await prisma.variant.findUniqueOrThrow({
      where: { id: variant.id },
      select: { assetId: true },
    });

    const updated = await prisma.asset.update({
      where: { id: asset.assetId },
      data: { rating: Rating.NSFW },
    });
    expect(updated.rating).toBe(Rating.NSFW);
  });

  // Contournement évident: créer sur Telegram, puis déplacer vers Instagram.
  it("rejette le déplacement d'une publication NSFW vers un canal Instagram", async () => {
    const telegram = await createChannel(personaId, Platform.TELEGRAM, Rating.NSFW);
    const instagram = await createChannel(personaId, Platform.INSTAGRAM, Rating.SFW);
    const publication = await createPublication(telegram.id, userId);
    const nsfw = await createVariant(personaId, userId, Rating.NSFW);

    await prisma.publicationItem.create({
      data: { publicationId: publication.id, variantId: nsfw.id, position: 0 },
    });

    await expect(
      prisma.publication.update({
        where: { id: publication.id },
        data: { channelAccountId: instagram.id },
      }),
    ).rejects.toThrow(/rating_violation/);
  });
});
