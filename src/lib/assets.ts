import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { Rating } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OrgContext } from "@/lib/session";

/**
 * Ingestion d'un Asset.
 *
 * Le volume local est la source de vérité et n'est jamais servi sur le réseau
 * (section 5). Les chemins stockés sont relatifs à MEDIA_ROOT, pour rester
 * valides aussi bien sur l'hôte que dans le conteneur.
 */

const MEDIA_ROOT = resolve(process.env.MEDIA_ROOT ?? "./media");

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".mp4", ".mov"]);

export type CreateAssetResult =
  | { ok: true; assetId: string; deduplicated: boolean }
  | { ok: false; error: string };

export async function createAssetFromUpload(
  ctx: OrgContext,
  input: { personaId: string; rating: Rating; file: File },
): Promise<CreateAssetResult> {
  // Scope serveur: la persona doit appartenir à l'organisation de la session.
  const persona = await prisma.persona.findFirst({
    where: { id: input.personaId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!persona) return { ok: false, error: "Persona introuvable." };

  const extension = extname(input.file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      error: `Extension non supportée: ${extension || "(aucune)"}. Attendu: ${[...ALLOWED_EXTENSIONS].join(", ")}.`,
    };
  }

  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (bytes.length === 0) return { ok: false, error: "Fichier vide." };

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // Déduplication par contenu, par persona (contrainte @@unique du modèle).
  const existing = await prisma.asset.findFirst({
    where: { personaId: input.personaId, sha256 },
    select: { id: true },
  });
  if (existing) return { ok: true, assetId: existing.id, deduplicated: true };

  const relativePath = join("assets", input.personaId, `${sha256}${extension}`);
  const absolutePath = join(MEDIA_ROOT, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  const asset = await prisma.asset.create({
    data: {
      personaId: input.personaId,
      createdByUserId: ctx.userId,
      // Immuable après création (9.4): pas d'édition, on recrée un Asset.
      rating: input.rating,
      localPath: relativePath,
      sha256,
      mimeType: input.file.type || null,
    },
    select: { id: true },
  });

  return { ok: true, assetId: asset.id, deduplicated: false };
}

export async function listAssets(ctx: OrgContext, personaId?: string) {
  return prisma.asset.findMany({
    where: {
      persona: { organizationId: ctx.organizationId },
      ...(personaId ? { personaId } : {}),
    },
    select: {
      id: true,
      rating: true,
      localPath: true,
      createdAt: true,
      personaId: true,
      createdBy: { select: { name: true } },
      variants: {
        select: { id: true, ratio: true, r2Key: true, localPath: true },
        orderBy: { ratio: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
