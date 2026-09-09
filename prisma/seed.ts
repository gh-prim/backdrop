/**
 * Seed d'amorçage.
 *
 * Il n'existe aucune route publique de création de compte (spec 9.8), et
 * l'Organization ne peut pas être créée depuis l'UI. Ce script est donc le
 * seul point d'entrée du premier owner. Tout le reste passe par invitation.
 *
 *   pnpm db:seed
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/db";

const ORG_NAME = process.env.SEED_ORG_NAME ?? "Backdrop";
const ORG_SLUG = process.env.SEED_ORG_SLUG ?? "backdrop";
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@backdrop.local";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "backdrop-owner-2026";
const OWNER_NAME = process.env.SEED_OWNER_NAME ?? "Owner";

async function main() {
  const ctx = await auth.$context;

  const organization =
    (await prisma.organization.findUnique({ where: { slug: ORG_SLUG } })) ??
    (await prisma.organization.create({
      data: { id: randomUUID(), name: ORG_NAME, slug: ORG_SLUG, createdAt: new Date() },
    }));

  let user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!user) {
    const created = await ctx.internalAdapter.createUser({
      id: randomUUID(),
      name: OWNER_NAME,
      email: OWNER_EMAIL,
      emailVerified: true,
    }, { method: "email-password" });
    await ctx.internalAdapter.createAccount({
      id: randomUUID(),
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: await ctx.password.hash(OWNER_PASSWORD),
    });
    user = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    console.log(`utilisateur créé: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  }

  const member = await prisma.member.findFirst({
    where: { organizationId: organization.id, userId: user.id },
  });
  if (!member) {
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    });
  }

  const personas = [
    { name: "Carolina Violet", handle: "carolina.violet", timezone: "Europe/Paris" },
  ];
  for (const persona of personas) {
    const existing = await prisma.persona.findFirst({
      where: { organizationId: organization.id, handle: persona.handle },
    });
    if (!existing) {
      await prisma.persona.create({
        data: { ...persona, organizationId: organization.id, bible: {} },
      });
    }
  }

  console.log(`organisation: ${organization.name} (${organization.slug})`);
  console.log(`owner: ${OWNER_EMAIL}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
