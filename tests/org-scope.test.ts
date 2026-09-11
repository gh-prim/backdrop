import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Platform, Rating } from "@prisma/client";
import {
  prisma,
  resetDatabase,
  createOrganization,
  createUser,
  createPersona,
  createChannel,
} from "./helpers";

/**
 * Spec 9.6: l'organizationId provient toujours de la session, jamais du client.
 * Un test doit prouver qu'une requête forgeant un organizationId étranger est
 * rejetée. Ces tests attaquent les fonctions de scope elles-mêmes.
 */
describe("isolation par organisation", () => {
  let orgA: string;
  let orgB: string;
  let personaA: string;
  let personaB: string;
  let userA: string;

  beforeEach(async () => {
    await resetDatabase();
    const a = await createOrganization("Alpha");
    const b = await createOrganization("Beta");
    const user = await createUser();
    orgA = a.id;
    orgB = b.id;
    userA = user.id;
    personaA = (await createPersona(orgA, "Carolina")).id;
    personaB = (await createPersona(orgB, "Intruse")).id;
    await prisma.member.create({
      data: { id: crypto.randomUUID(), organizationId: orgA, userId: userA, role: "owner", createdAt: new Date() },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("listPersonas ne renvoie que les personas de l'organisation de la session", async () => {
    const { listPersonas } = await import("@/lib/persona-scope");
    const personas = await listPersonas({
      userId: userA,
      userName: "Test",
      userEmail: "a@test.local",
      organizationId: orgA,
      role: "owner",
    });

    expect(personas.map((p) => p.id)).toEqual([personaA]);
    expect(personas.map((p) => p.id)).not.toContain(personaB);
  });

  it("resolvePersona renvoie null pour une persona d'une autre organisation", async () => {
    const { resolvePersona } = await import("@/lib/session");
    const ctx = {
      userId: userA,
      userName: "Test",
      userEmail: "a@test.local",
      organizationId: orgA,
      role: "owner" as const,
    };

    // Un client qui forge l'identifiant d'une persona étrangère n'obtient rien:
    // la persona existe, mais elle est invisible depuis cette session.
    expect(await prisma.persona.findUnique({ where: { id: personaB } })).not.toBeNull();
    expect(await resolvePersona(personaB, ctx)).toBeNull();
    expect(await resolvePersona(personaA, ctx)).not.toBeNull();
  });

  it("l'inbox ne laisse pas lire le fil d'une autre organisation", async () => {
    const { listConversations, getConversation, countUnread } = await import(
      "@/lib/inbox"
    );
    const channelB = await createChannel(personaB, Platform.TELEGRAM, Rating.NSFW);
    const intruse = await prisma.conversation.create({
      data: {
        channelAccountId: channelB.id,
        externalId: "424242",
        title: "Conversation privée",
        unreadCount: 3,
        lastMessageAt: new Date(),
      },
      select: { id: true },
    });

    const ctx = {
      userId: userA,
      userName: "Test",
      userEmail: "a@test.local",
      organizationId: orgA,
      role: "owner" as const,
    };

    // Le fil existe — et reste invisible depuis l'autre organisation, même en
    // forgeant son identifiant. C'est le contenu le plus sensible de l'outil.
    expect(await prisma.conversation.findUnique({ where: { id: intruse.id } }))
      .not.toBeNull();
    expect(await listConversations(ctx)).toEqual([]);
    expect(await getConversation(ctx, intruse.id)).toBeNull();
    expect(await countUnread(ctx)).toBe(0);
  });

  it("listChannelStatus ne traverse jamais la frontière d'organisation", async () => {
    const { listChannelStatus } = await import("@/lib/channels");
    await createChannel(personaA, Platform.INSTAGRAM, Rating.SFW);
    await createChannel(personaB, Platform.TELEGRAM, Rating.NSFW);

    const channels = await listChannelStatus({
      userId: userA,
      userName: "Test",
      userEmail: "a@test.local",
      organizationId: orgA,
      role: "owner",
    });

    expect(channels).toHaveLength(1);
    expect(channels[0].personaId).toBe(personaA);
  });
});
