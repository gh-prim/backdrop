/**
 * Amorce de développement: fabrique un Asset de test et lance ses dérivations.
 *
 *   pnpm tsx scripts/dev-ingest.ts [SFW|SUGGESTIVE|NSFW]
 *
 * Sert à exercer ffmpeg et le workflow ingestVariant sans passer par l'UI.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PrismaClient, Rating } from "@prisma/client";
import { startIngestWorkflow } from "../src/temporal/client";

const prisma = new PrismaClient();
const MEDIA_ROOT = resolve(process.env.MEDIA_ROOT ?? "./media");
const rating = (process.argv[2] ?? "SFW") as Rating;

async function main() {
  const persona = await prisma.persona.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });

  // Une mire ffmpeg. La taille varie avec le rating pour que les fichiers
  // diffèrent et ne se dédupliquent pas entre eux.
  const sizes: Record<string, string> = {
    SFW: "1600x1200",
    SUGGESTIVE: "1500x1200",
    NSFW: "1400x1200",
  };
  const tmp = join(MEDIA_ROOT, `tmp-${rating}.jpg`);
  mkdirSync(dirname(tmp), { recursive: true });
  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi",
    "-i", `testsrc=size=${sizes[rating] ?? "1600x1200"}:rate=1:duration=1`,
    "-frames:v", "1",
    tmp,
  ], { stdio: "ignore" });

  const bytes = readFileSync(tmp);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const relative = join("assets", persona.id, `${sha256}.jpg`);
  mkdirSync(dirname(join(MEDIA_ROOT, relative)), { recursive: true });
  execFileSync("cp", [tmp, join(MEDIA_ROOT, relative)]);

  const asset = await prisma.asset.upsert({
    where: { personaId_sha256: { personaId: persona.id, sha256 } },
    create: {
      personaId: persona.id,
      createdByUserId: user.id,
      rating,
      localPath: relative,
      sha256,
      mimeType: "image/jpeg",
    },
    update: {},
    select: { id: true },
  });

  for (const ratio of ["4:5", "9:16"]) {
    const workflowId = await startIngestWorkflow({ assetId: asset.id, ratio });
    console.log(`ingestVariant démarré: ${workflowId}`);
  }

  console.log(`Asset ${asset.id} (${rating}) sur la persona ${persona.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
