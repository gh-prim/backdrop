import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Platform, PubKind, PubStatus } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { startFanvuePublishWorkflow } from "../src/temporal/client";

/**
 * Publie un post Fanvue en passant par le chemin applicatif.
 *
 * Sert quand l'interface n'est pas atteignable — pas de session ouverte dans
 * le navigateur de service. Le script n'invente rien: il appelle
 * `createPublication` puis démarre le même workflow que le composeur, garde-fou
 * de rating de la base compris.
 *
 *   pnpm tsx scripts/fanvue-post.ts "légende" variantId [variantId…]
 */
async function main() {
  const [caption, ...variantIds] = process.argv.slice(2);
  if (!caption || variantIds.length === 0) {
    throw new Error('usage: fanvue-post.ts "légende" variantId [variantId…]');
  }

  const channel = await prisma.channelAccount.findFirst({
    where: { platform: Platform.FANVUE },
    select: {
      id: true,
      persona: { select: { id: true, name: true, organizationId: true } },
    },
  });
  if (!channel) throw new Error("Aucun canal Fanvue connecté.");

  const owner = await prisma.member.findFirst({
    where: { organizationId: channel.persona.organizationId, role: "owner" },
    select: { userId: true },
  });
  if (!owner) throw new Error("Aucun owner dans cette organisation.");

  const publication = await prisma.publication.create({
    data: {
      groupId: randomUUID(),
      channelAccountId: channel.id,
      createdByUserId: owner.userId,
      kind: PubKind.FV_POST,
      name: "Pool set — Fanvue",
      copy: caption,
      scheduledAt: new Date(),
      status: PubStatus.SCHEDULED,
      audience: "subscribers",
      items: {
        create: variantIds.map((variantId, position) => ({ variantId, position })),
      },
    },
    select: { id: true },
  });

  await startFanvuePublishWorkflow(publication.id);
  console.log(`publication ${publication.id} démarrée sur Fanvue`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("post Fanvue:", error.message);
  await prisma.$disconnect();
  process.exit(1);
});
