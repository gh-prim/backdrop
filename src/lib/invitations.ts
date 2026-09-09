import "server-only";
import { randomUUID } from "node:crypto";
import { auth, type OrgRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { OrgContext } from "@/lib/session";

/**
 * Cycle de vie des invitations.
 *
 * L'inscription publique est fermée (9.8): un compte ne naît que d'une
 * invitation émise par un `owner`. Il n'y a pas de fournisseur d'email à ce
 * stade, donc l'owner récupère un lien et le transmet lui-même. C'est
 * volontaire: un canal de moins à sécuriser, et l'équipe tient dans une pièce.
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  expired: boolean;
};

export async function listMembers(ctx: OrgContext) {
  return prisma.member.findMany({
    where: { organizationId: ctx.organizationId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function listPendingInvitations(
  ctx: OrgContext,
): Promise<PendingInvitation[]> {
  const rows = await prisma.invitation.findMany({
    where: { organizationId: ctx.organizationId, status: "pending" },
    select: { id: true, email: true, role: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    role: row.role ?? "member",
    expired: row.expiresAt.getTime() < now,
  }));
}

export async function createInvitation(
  ctx: OrgContext,
  email: string,
  role: OrgRole,
) {
  const normalized = email.trim().toLowerCase();

  const existingMember = await prisma.member.findFirst({
    where: { organizationId: ctx.organizationId, user: { email: normalized } },
  });
  if (existingMember) {
    throw new Error("Cette adresse est déjà membre de l'organisation.");
  }

  // Une seule invitation vivante par adresse: la précédente est remplacée.
  await prisma.invitation.updateMany({
    where: { organizationId: ctx.organizationId, email: normalized, status: "pending" },
    data: { status: "cancelled" },
  });

  return prisma.invitation.create({
    data: {
      id: randomUUID(),
      organizationId: ctx.organizationId,
      email: normalized,
      role,
      status: "pending",
      inviterId: ctx.userId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
}

export async function cancelInvitation(ctx: OrgContext, invitationId: string) {
  // Scope: on ne peut annuler qu'une invitation de sa propre organisation.
  await prisma.invitation.updateMany({
    where: { id: invitationId, organizationId: ctx.organizationId, status: "pending" },
    data: { status: "cancelled" },
  });
}

export type InvitationView = {
  id: string;
  email: string;
  organizationName: string;
  role: string;
};

/** Invitation utilisable, sans rien exposer d'autre que le strict nécessaire. */
export async function getUsableInvitation(
  invitationId: string,
): Promise<InvitationView | null> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      organization: { select: { name: true } },
    },
  });
  if (!invitation) return null;
  if (invitation.status !== "pending") return null;
  if (invitation.expiresAt.getTime() < Date.now()) return null;

  return {
    id: invitation.id,
    email: invitation.email,
    organizationName: invitation.organization.name,
    role: invitation.role ?? "member",
  };
}

/**
 * Seul chemin de création de compte de l'application.
 *
 * `disableSignUp` ferme la route publique de Better Auth; on passe donc par
 * l'adaptateur interne, après avoir validé l'invitation. L'email vient de
 * l'invitation, jamais du formulaire: on ne peut pas se faire inviter à une
 * adresse et créer le compte sur une autre.
 */
export async function acceptInvitation(
  invitationId: string,
  input: { name: string; password: string },
) {
  const invitation = await getUsableInvitation(invitationId);
  if (!invitation) {
    throw new Error("Invitation invalide ou expirée.");
  }

  const ctx = await auth.$context;
  const role: OrgRole = invitation.role === "owner" ? "owner" : "member";

  const existing = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });

  const userId = existing
    ? existing.id
    : await (async () => {
        const created = await ctx.internalAdapter.createUser({
          id: randomUUID(),
          name: input.name.trim(),
          email: invitation.email,
          emailVerified: true,
        });
        await ctx.internalAdapter.createAccount({
          id: randomUUID(),
          userId: created.id,
          providerId: "credential",
          accountId: created.id,
          password: await ctx.password.hash(input.password),
        });
        return created.id;
      })();

  const organizationId = (
    await prisma.invitation.findUniqueOrThrow({
      where: { id: invitationId },
      select: { organizationId: true },
    })
  ).organizationId;

  const alreadyMember = await prisma.member.findFirst({
    where: { organizationId, userId },
  });
  if (!alreadyMember) {
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId,
        role,
        createdAt: new Date(),
      },
    });
  }

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "accepted" },
  });

  return { userId, email: invitation.email };
}
