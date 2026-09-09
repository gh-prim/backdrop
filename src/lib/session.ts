import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type OrgRole } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type OrgContext = {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  role: OrgRole;
};

export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

/**
 * Contexte d'organisation de la requête.
 *
 * Règle de sécurité (spec 9.6): l'`organizationId` provient toujours de la
 * session, jamais d'un paramètre de requête, d'une URL ou d'un corps JSON.
 * Toute lecture ou écriture applicative passe par ici.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const session = await getSession();
  if (!session) return null;

  const memberships = await prisma.member.findMany({
    where: { userId: session.user.id },
    select: { organizationId: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;

  // L'organisation active de la session ne compte que si l'utilisateur en est
  // bien membre. Sinon, première appartenance.
  const activeId = session.session.activeOrganizationId;
  const membership =
    memberships.find((m) => m.organizationId === activeId) ?? memberships[0];

  return {
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    organizationId: membership.organizationId,
    role: membership.role === "owner" ? "owner" : "member",
  };
});

export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Réservé aux actions `owner` (7.4): membres, personas, ChannelAccount. */
export async function requireOwner(): Promise<OrgContext> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") {
    throw new Error("Action réservée au rôle owner.");
  }
  return ctx;
}

/**
 * Garde-fou de scope: résout une persona en la contraignant à l'organisation
 * de la session. Renvoie null si la persona appartient à une autre org,
 * exactement comme si elle n'existait pas.
 */
export async function resolvePersona(personaId: string, ctx: OrgContext) {
  return prisma.persona.findFirst({
    where: { id: personaId, organizationId: ctx.organizationId },
  });
}
