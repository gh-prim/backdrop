import { randomUUID } from "node:crypto";
import { PrismaClient, Platform, Rating, PubKind, PubStatus } from "@prisma/client";

export const prisma = new PrismaClient();

/** Vide les tables applicatives et d'authentification entre deux tests. */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "PublicationItem", "Publication", "DmDelivery", "DmCampaignItem", "DmCampaign",
      "TelegramSubscriber", "MetricSnapshot", "FanvueEarning", "Variant", "Asset",
      "ChannelAccount", "Persona", "member", "invitation", "session", "account",
      "user", "organization"
    RESTART IDENTITY CASCADE;
  `);
}

export async function createOrganization(name = "Org") {
  return prisma.organization.create({
    data: { id: randomUUID(), name, slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`, createdAt: new Date() },
  });
}

export async function createUser(email = `u-${randomUUID().slice(0, 8)}@test.local`) {
  return prisma.user.create({
    data: { id: randomUUID(), name: "Test", email, emailVerified: true, updatedAt: new Date() },
  });
}

export async function createPersona(organizationId: string, name = "Persona") {
  return prisma.persona.create({
    data: {
      organizationId,
      name,
      handle: `${name.toLowerCase()}-${randomUUID().slice(0, 6)}`,
      timezone: "Europe/Paris",
      bible: {},
    },
  });
}

export async function createChannel(
  personaId: string,
  platform: Platform,
  maxRating: Rating,
) {
  return prisma.channelAccount.create({
    data: {
      personaId,
      platform,
      externalId: randomUUID(),
      credentials: Buffer.from("chiffré-au-repos"),
      maxRating,
    },
  });
}

export async function createVariant(personaId: string, userId: string, rating: Rating) {
  const asset = await prisma.asset.create({
    data: {
      personaId,
      createdByUserId: userId,
      rating,
      localPath: `/media/${randomUUID()}.jpg`,
      sha256: randomUUID().replace(/-/g, ""),
    },
  });
  return prisma.variant.create({
    data: { assetId: asset.id, ratio: "4:5", localPath: `/media/${randomUUID()}-45.jpg` },
  });
}

export async function createPublication(
  channelAccountId: string,
  userId: string,
  kind: PubKind = PubKind.SINGLE,
) {
  return prisma.publication.create({
    data: {
      channelAccountId,
      createdByUserId: userId,
      kind,
      copy: "légende",
      scheduledAt: new Date(Date.now() + 3_600_000),
      status: PubStatus.SCHEDULED,
    },
  });
}
