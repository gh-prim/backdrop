import "dotenv/config";
import { Platform } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { fanvueAdapterFor } from "../src/lib/channels/fanvue-account";

/**
 * Sonde de connexion Fanvue.
 *
 * Vérifie que les jetons stockés fonctionnent — et rien d'autre: aucune
 * écriture, aucun post. N'imprime jamais un jeton.
 */
async function main() {
  const account = await prisma.channelAccount.findFirst({
    where: { platform: Platform.FANVUE },
    select: { id: true, externalId: true, persona: { select: { name: true } } },
  });
  if (!account) throw new Error("Aucun compte Fanvue connecté.");

  const adapter = await fanvueAdapterFor(account.id);
  if (!adapter) throw new Error("Adapter introuvable.");

  const me = await adapter.me();
  console.log(`persona ${account.persona.name} → @${me.handle} (${me.uuid})`);

  const posts = await adapter.recentPosts(3);
  console.log(`posts récents: ${posts.length}`);
  for (const post of posts) {
    console.log(`  ${post.uuid} — ${post.price ?? "gratuit"} — ${post.publishedAt ?? "non publié"}`);
  }

  const quota = await adapter.checkQuota();
  console.log(`quota annoncé: ${quota.limit} requêtes / 60 s`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("sonde Fanvue:", error.message);
  await prisma.$disconnect();
  process.exit(1);
});
