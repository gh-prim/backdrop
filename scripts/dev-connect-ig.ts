/**
 * Connecte un canal Instagram de développement, avec un token volontairement
 * non fonctionnel: sert à exercer l UI, pas à publier.
 */
import "dotenv/config";
import { PrismaClient, Platform, Rating } from "@prisma/client";
import { encryptCredentials } from "../src/lib/crypto";
const prisma = new PrismaClient();
async function main() {
  const persona = await prisma.persona.findFirstOrThrow();
  await prisma.channelAccount.upsert({
    where: { personaId_platform_externalId: { personaId: persona.id, platform: Platform.INSTAGRAM, externalId: "17841400000000000" } },
    create: {
      personaId: persona.id, platform: Platform.INSTAGRAM, externalId: "17841400000000000",
      credentials: encryptCredentials({ igUserId: "17841400000000000", accessToken: "token-de-dev-non-fonctionnel" }),
      maxRating: Rating.SFW, tokenExpiresAt: new Date(Date.now() + 55 * 86400000),
    },
    update: {},
  });
  console.log("canal Instagram de dev connecté sur", persona.name);
}
main().finally(() => prisma.$disconnect());
