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
import { randomBytes, randomUUID } from "node:crypto";
import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/db";

const ORG_NAME = process.env.SEED_ORG_NAME ?? "Backdrop";
const ORG_SLUG = process.env.SEED_ORG_SLUG ?? "backdrop";
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@backdrop.local";
/**
 * Mot de passe du premier owner.
 *
 * Aucune valeur par défaut: un mot de passe écrit dans le dépôt est un mot de
 * passe connu de tous, et celui-ci ouvre le compte qui administre l'outil.
 * Faute de `SEED_OWNER_PASSWORD`, on en tire un au hasard et on l'affiche une
 * fois — à recopier tout de suite, il n'est écrit nulle part.
 */
const GENERATED = randomBytes(18).toString("base64url");
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? GENERATED;
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
    console.log(`user created: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
    if (!process.env.SEED_OWNER_PASSWORD) {
      console.log("Mot de passe tiré au hasard: le noter maintenant.");
    }
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

  // Aucune persona par défaut: une persona porte un nom, un fuseau et une
  // bible éditoriale qui n'appartiennent qu'à l'installation. En inventer une
  // ici reviendrait à livrer le compte de quelqu'un d'autre.
  //
  // Elles se créent depuis Réglages → Personas, par un owner.

  console.log(`organization: ${organization.name} (${organization.slug})`);
  console.log(`owner: ${OWNER_EMAIL}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
