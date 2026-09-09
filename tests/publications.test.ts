import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Platform, PubKind, PubStatus, Rating } from "@prisma/client";
import {
  prisma,
  resetDatabase,
  createOrganization,
  createUser,
  createPersona,
  createChannel,
  createVariant,
} from "./helpers";

/**
 * Édition concurrente et scope, côté Publication (spec 7.4).
 */
describe("publications", () => {
  let orgId: string;
  let userId: string;
  let personaId: string;
  let channelId: string;

  beforeEach(async () => {
    await resetDatabase();
    const org = await createOrganization("Equipe");
    const user = await createUser();
    orgId = org.id;
    userId = user.id;
    await prisma.member.create({
      data: { id: randomUUID(), organizationId: orgId, userId, role: "owner", createdAt: new Date() },
    });
    personaId = (await createPersona(orgId)).id;
    channelId = (await createChannel(personaId, Platform.INSTAGRAM, Rating.SFW)).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function ctx(organizationId = orgId) {
    return {
      userId,
      userName: "Op",
      userEmail: "op@test.local",
      organizationId,
      role: "owner" as const,
    };
  }

  async function scheduleOne() {
    const { createPublication } = await import("@/lib/publications");
    const variant = await createVariant(personaId, userId, Rating.SFW);
    return createPublication(ctx(), {
      channelAccountId: channelId,
      kind: PubKind.SINGLE,
      caption: "première légende",
      scheduledAt: new Date(Date.now() + 3_600_000),
      variantIds: [variant.id],
    });
  }

  it("crée une publication programmée avec son auteur", async () => {
    const { id } = await scheduleOne();

    const publication = await prisma.publication.findUniqueOrThrow({
      where: { id },
      select: { status: true, createdByUserId: true, version: true, items: true },
    });

    expect(publication.status).toBe(PubStatus.SCHEDULED);
    // Attribution: indispensable dès qu'on est plusieurs sur les mêmes comptes.
    expect(publication.createdByUserId).toBe(userId);
    expect(publication.version).toBe(0);
    expect(publication.items).toHaveLength(1);
  });

  it("rejette la seconde écriture concurrente sans écraser la première", async () => {
    const { updateScheduledPublication, StaleVersionError } = await import(
      "@/lib/publications"
    );
    const { id } = await scheduleOne();

    // Deux opérateurs ont ouvert la même publication en version 0.
    await updateScheduledPublication(ctx(), {
      publicationId: id,
      expectedVersion: 0,
      caption: "légende de l'opérateur A",
      scheduledAt: new Date(Date.now() + 7_200_000),
    });

    await expect(
      updateScheduledPublication(ctx(), {
        publicationId: id,
        expectedVersion: 0,
        caption: "légende de l'opérateur B",
        scheduledAt: new Date(Date.now() + 10_800_000),
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);

    // Le travail du premier est intact: le second est rejeté, pas fusionné.
    const publication = await prisma.publication.findUniqueOrThrow({ where: { id } });
    expect(publication.copy).toBe("légende de l'opérateur A");
    expect(publication.version).toBe(1);
  });

  it("accepte la réécriture une fois la version rechargée", async () => {
    const { updateScheduledPublication } = await import("@/lib/publications");
    const { id } = await scheduleOne();

    await updateScheduledPublication(ctx(), {
      publicationId: id,
      expectedVersion: 0,
      caption: "A",
      scheduledAt: new Date(Date.now() + 7_200_000),
    });
    const { version } = await updateScheduledPublication(ctx(), {
      publicationId: id,
      expectedVersion: 1,
      caption: "B après rechargement",
      scheduledAt: new Date(Date.now() + 7_200_000),
    });

    expect(version).toBe(2);
    const publication = await prisma.publication.findUniqueOrThrow({ where: { id } });
    expect(publication.copy).toBe("B après rechargement");
  });

  it("refuse de créer une publication sur un canal d'une autre organisation", async () => {
    const { createPublication } = await import("@/lib/publications");
    const other = await createOrganization("Autre");
    const variant = await createVariant(personaId, userId, Rating.SFW);

    await expect(
      createPublication(ctx(other.id), {
        channelAccountId: channelId,
        kind: PubKind.SINGLE,
        caption: "intrusion",
        scheduledAt: new Date(Date.now() + 3_600_000),
        variantIds: [variant.id],
      }),
    ).rejects.toThrow(/introuvable/i);

    expect(await prisma.publication.count()).toBe(0);
  });

  it("ne laisse aucune publication orpheline quand le rating est rejeté", async () => {
    const { createPublication } = await import("@/lib/publications");
    const nsfw = await createVariant(personaId, userId, Rating.NSFW);

    await expect(
      createPublication(ctx(), {
        channelAccountId: channelId,
        kind: PubKind.SINGLE,
        caption: "interdit sur Instagram",
        scheduledAt: new Date(Date.now() + 3_600_000),
        variantIds: [nsfw.id],
      }),
    ).rejects.toThrow(/rating_violation/);

    // La transaction couvre la publication et ses items: le rejet du trigger
    // ne doit pas laisser une publication vide derrière lui.
    expect(await prisma.publication.count()).toBe(0);
    expect(await prisma.publicationItem.count()).toBe(0);
  });

  it("remet une publication MISSED en file, sans perdre l'attribution", async () => {
    const { requeueMissedPublication } = await import("@/lib/publications");
    const { id } = await scheduleOne();
    await prisma.publication.update({
      where: { id },
      data: { status: PubStatus.MISSED },
    });

    await requeueMissedPublication(ctx(), id);

    const publication = await prisma.publication.findUniqueOrThrow({ where: { id } });
    expect(publication.status).toBe(PubStatus.SCHEDULED);
    expect(publication.createdByUserId).toBe(userId);
  });
});
