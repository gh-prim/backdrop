import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { unlink } from "node:fs/promises";
import { Rating } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deleteObjects } from "@/lib/storage";
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
  if (!persona) return { ok: false, error: "Persona not found." };

  const extension = extname(input.file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      error: `Unsupported extension: ${extension || "(none)"}. Expected: ${[...ALLOWED_EXTENSIONS].join(", ")}.`,
    };
  }

  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (bytes.length === 0) return { ok: false, error: "Empty file." };

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

/**
 * Fiche complète d'un média: métadonnées, variants, et **usages**.
 *
 * L'usage est ce qui manque le plus quand on gère plusieurs personas: savoir
 * si un média est déjà parti, où, et quand, évite de le republier par erreur.
 */
export async function getAssetDetail(ctx: OrgContext, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, persona: { organizationId: ctx.organizationId } },
    select: {
      id: true,
      name: true,
      rating: true,
      localPath: true,
      sha256: true,
      mimeType: true,
      description: true,
      width: true,
      height: true,
      durationMs: true,
      sizeBytes: true,
      createdAt: true,
      personaId: true,
      persona: { select: { id: true, name: true, handle: true } },
      createdBy: { select: { name: true, email: true } },
      variants: {
        orderBy: { ratio: "asc" },
        select: {
          id: true,
          ratio: true,
          localPath: true,
          r2Key: true,
          tgSourceMessageId: true,
          fvMediaUuid: true,
          createdAt: true,
        },
      },
    },
  });
  if (!asset) return null;

  const usages = await prisma.publicationItem.findMany({
    where: { variant: { assetId } },
    select: {
      position: true,
      variant: { select: { ratio: true } },
      publication: {
        select: {
          id: true,
          name: true,
          kind: true,
          status: true,
          scheduledAt: true,
          publishedAt: true,
          remoteId: true,
          channelAccount: { select: { platform: true } },
        },
      },
    },
    orderBy: { publication: { scheduledAt: "desc" } },
  });

  return { ...asset, usages };
}

export class AssetInUseError extends Error {
  constructor(count: number) {
    super(
      `This media is used by ${count} publication${count > 1 ? "s" : ""}. Delete them first, or keep the media: its history would go with it.`,
    );
    this.name = "AssetInUseError";
  }
}

export type UpdateAssetInput = {
  name?: string;
  description?: string;
  rating?: Rating;
};

/**
 * Modifie les propriétés éditables d'un Asset.
 *
 * Le rating est modifiable (9.4), mais sous deux contraintes qui ne se
 * négocient pas:
 *
 *  - la **base** revalide toutes les publications qui référencent ce média;
 *    reclasser en NSFW un média programmé sur Instagram est refusé par le
 *    trigger, pas par une vérification applicative qu'on pourrait oublier;
 *  - un média qui cesse d'être SFW est **retiré de R2**. Le laisser en ligne
 *    après reclassement viderait de son sens la séparation de la section 5:
 *    l'URL publique resterait téléchargeable par n'importe qui.
 */
export async function updateAsset(
  ctx: OrgContext,
  assetId: string,
  input: UpdateAssetInput,
): Promise<{ removedFromR2: number }> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, persona: { organizationId: ctx.organizationId } },
    select: {
      id: true,
      rating: true,
      variants: { select: { id: true, r2Key: true } },
    },
  });
  if (!asset) throw new Error("Asset not found.");

  await prisma.asset.update({
    where: { id: assetId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() || null } : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() || null }
        : {}),
      ...(input.rating !== undefined ? { rating: input.rating } : {}),
    },
  });

  const becameSensitive =
    input.rating !== undefined &&
    input.rating !== Rating.SFW &&
    asset.rating === Rating.SFW;

  if (!becameSensitive) return { removedFromR2: 0 };

  const keys = asset.variants.map((v) => v.r2Key).filter((key): key is string => Boolean(key));
  const removed = await deleteObjects(keys);
  await prisma.variant.updateMany({
    where: { assetId },
    data: { r2Key: null },
  });

  return { removedFromR2: removed };
}

/**
 * Supprime un Asset, ses Variants, ses fichiers locaux et ses objets R2.
 *
 * Refusé si une publication le référence: son historique disparaîtrait avec
 * lui, et une publication sans média est une ligne qu'on ne sait plus lire.
 */
export async function deleteAsset(
  ctx: OrgContext,
  assetId: string,
): Promise<{ removedFromR2: number }> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, persona: { organizationId: ctx.organizationId } },
    select: {
      id: true,
      localPath: true,
      variants: { select: { id: true, localPath: true, r2Key: true } },
    },
  });
  if (!asset) throw new Error("Asset not found.");

  const usage = await prisma.publicationItem.count({
    where: { variant: { assetId } },
  });
  if (usage > 0) throw new AssetInUseError(usage);

  const removed = await deleteObjects(
    asset.variants.map((v) => v.r2Key).filter((key): key is string => Boolean(key)),
  );

  await prisma.asset.delete({ where: { id: assetId } });

  // Les fichiers en dernier: une base propre avec un fichier orphelin se
  // rattrape, l'inverse laisse une ligne qui pointe dans le vide.
  for (const path of [asset.localPath, ...asset.variants.map((v) => v.localPath)]) {
    await unlink(join(MEDIA_ROOT, path)).catch(() => {});
  }

  return { removedFromR2: removed };
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
      name: true,
      description: true,
      createdBy: { select: { name: true } },
      variants: {
        select: {
          id: true,
          ratio: true,
          r2Key: true,
          localPath: true,
          // Compter les publications qui s'appuient sur ce Variant: la grille
          // signale ainsi un média déjà parti sans ouvrir sa fiche.
          _count: { select: { publicationItems: true } },
        },
        orderBy: { ratio: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
