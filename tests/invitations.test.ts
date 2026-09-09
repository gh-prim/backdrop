import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  prisma,
  resetDatabase,
  createOrganization,
  createUser,
  createPersona,
} from "./helpers";

/**
 * DoD phase 0: un owner peut inviter un second compte, celui-ci se connecte et
 * voit les mêmes personas. Et il n'existe aucune autre voie de création de
 * compte (9.8).
 */
describe("invitations", () => {
  let orgId: string;
  let ownerId: string;
  let personaId: string;

  beforeEach(async () => {
    await resetDatabase();
    const org = await createOrganization("Equipe");
    const owner = await createUser("owner@test.local");
    orgId = org.id;
    ownerId = owner.id;
    await prisma.member.create({
      data: { id: randomUUID(), organizationId: orgId, userId: ownerId, role: "owner", createdAt: new Date() },
    });
    personaId = (await createPersona(orgId, "Carolina")).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function ownerCtx() {
    return {
      userId: ownerId,
      userName: "Owner",
      userEmail: "owner@test.local",
      organizationId: orgId,
      role: "owner" as const,
    };
  }

  it("un owner invite, l'invité crée son compte et rejoint l'organisation", async () => {
    const { createInvitation, acceptInvitation } = await import("@/lib/invitations");
    const { listPersonas } = await import("@/lib/persona-scope");

    const invitation = await createInvitation(ownerCtx(), "Operateur@Test.local", "member");
    // L'email est normalisé, pour que l'invitation et la connexion coïncident.
    expect(invitation.email).toBe("operateur@test.local");

    const { userId } = await acceptInvitation(invitation.id, {
      name: "Opérateur",
      password: "mot-de-passe-assez-long",
    });

    const member = await prisma.member.findFirstOrThrow({
      where: { organizationId: orgId, userId },
    });
    expect(member.role).toBe("member");

    // Il voit exactement le même portefeuille que l'owner (7.4).
    const personas = await listPersonas({
      userId,
      userName: "Opérateur",
      userEmail: invitation.email,
      organizationId: orgId,
      role: "member",
    });
    expect(personas.map((p) => p.id)).toEqual([personaId]);

    // Le compte est utilisable: un credential a bien été posé.
    const account = await prisma.account.findFirstOrThrow({
      where: { userId, providerId: "credential" },
    });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain("mot-de-passe-assez-long");
  });

  it("une invitation ne peut être consommée qu'une fois", async () => {
    const { createInvitation, acceptInvitation } = await import("@/lib/invitations");
    const invitation = await createInvitation(ownerCtx(), "double@test.local", "member");

    await acceptInvitation(invitation.id, { name: "A", password: "mot-de-passe-long-1" });
    await expect(
      acceptInvitation(invitation.id, { name: "B", password: "mot-de-passe-long-2" }),
    ).rejects.toThrow(/invalid or expired/i);

    expect(await prisma.user.count({ where: { email: "double@test.local" } })).toBe(1);
  });

  it("une invitation expirée est refusée", async () => {
    const { acceptInvitation } = await import("@/lib/invitations");
    const invitation = await prisma.invitation.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        email: "tard@test.local",
        role: "member",
        status: "pending",
        inviterId: ownerId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await expect(
      acceptInvitation(invitation.id, { name: "Tard", password: "mot-de-passe-long-3" }),
    ).rejects.toThrow(/invalid or expired/i);
    expect(await prisma.user.count({ where: { email: "tard@test.local" } })).toBe(0);
  });

  it("une invitation annulée ne crée aucun compte", async () => {
    const { createInvitation, cancelInvitation, acceptInvitation } = await import(
      "@/lib/invitations"
    );
    const invitation = await createInvitation(ownerCtx(), "annule@test.local", "member");
    await cancelInvitation(ownerCtx(), invitation.id);

    await expect(
      acceptInvitation(invitation.id, { name: "X", password: "mot-de-passe-long-4" }),
    ).rejects.toThrow(/invalid or expired/i);
    expect(await prisma.user.count({ where: { email: "annule@test.local" } })).toBe(0);
  });

  it("un owner ne peut annuler que les invitations de son organisation", async () => {
    const { createInvitation, cancelInvitation, getUsableInvitation } = await import(
      "@/lib/invitations"
    );
    const other = await createOrganization("Autre");
    const otherOwner = await createUser("autre@test.local");
    const foreign = await createInvitation(
      {
        userId: otherOwner.id,
        userName: "Autre",
        userEmail: "autre@test.local",
        organizationId: other.id,
        role: "owner",
      },
      "cible@test.local",
      "member",
    );

    // L'owner de la première organisation tente d'annuler celle de la seconde.
    await cancelInvitation(ownerCtx(), foreign.id);
    expect(await getUsableInvitation(foreign.id)).not.toBeNull();
  });

  it("le rôle est celui de l'invitation, pas celui demandé par l'invité", async () => {
    const { createInvitation, acceptInvitation } = await import("@/lib/invitations");
    const invitation = await createInvitation(ownerCtx(), "simple@test.local", "member");

    const { userId } = await acceptInvitation(invitation.id, {
      name: "Simple",
      password: "mot-de-passe-long-5",
    });

    const member = await prisma.member.findFirstOrThrow({ where: { userId } });
    expect(member.role).toBe("member");
  });
});
