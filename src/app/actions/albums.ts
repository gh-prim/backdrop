"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireOrgContext } from "@/lib/session";

export type AlbumResult =
  | { ok: true; albumId: string; message?: string }
  | { ok: false; error: string };

const nameSchema = z.string().trim().min(1, "A name is required.").max(80);

/**
 * Vérifie que des médias appartiennent bien à une persona de l'organisation.
 *
 * Les identifiants viennent du formulaire: sans ce contrôle, il suffirait de
 * les modifier pour rattacher les médias d'un autre tenant (7.4).
 */
async function assertOwned(
  ctx: { organizationId: string },
  assetIds: string[],
): Promise<{ personaId: string } | null> {
  if (assetIds.length === 0) return null;

  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, persona: { organizationId: ctx.organizationId } },
    select: { id: true, personaId: true },
  });
  if (assets.length !== assetIds.length) return null;

  // Un album appartient à une persona: mélanger deux personas rendrait son
  // envoi impossible, puisqu'un envoi vise les canaux d'une seule.
  const personas = new Set(assets.map((asset) => asset.personaId));
  if (personas.size !== 1) return null;

  return { personaId: assets[0].personaId };
}

/** Crée un album à partir des médias sélectionnés. */
export async function createAlbumAction(
  _prev: AlbumResult | null,
  formData: FormData,
): Promise<AlbumResult> {
  const ctx = await requireOrgContext();

  const parsed = nameSchema.safeParse(formData.get("name") ?? "");
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  const assetIds = formData.getAll("assetIds").map(String);
  const owned = await assertOwned(ctx, assetIds);
  if (!owned) {
    return { ok: false, error: "Pick media from a single persona of this organization." };
  }

  try {
    const album = await prisma.album.create({
      data: {
        personaId: owned.personaId,
        name: parsed.data,
        items: {
          create: assetIds.map((assetId, position) => ({ assetId, position })),
        },
      },
      select: { id: true },
    });

    revalidatePath("/library");
    return { ok: true, albumId: album.id, message: `Album “${parsed.data}” created.` };
  } catch (error) {
    // L'unicité du nom par persona: deux albums homonymes seraient
    // indiscernables dans le sélecteur du composeur.
    if (String(error).includes("Unique constraint")) {
      return { ok: false, error: `An album named “${parsed.data}” already exists.` };
    }
    return { ok: false, error: (error as Error).message };
  }
}

/** Ajoute des médias à un album existant, sans doublon. */
export async function addToAlbumAction(
  _prev: AlbumResult | null,
  formData: FormData,
): Promise<AlbumResult> {
  const ctx = await requireOrgContext();

  const albumId = String(formData.get("albumId") ?? "");
  const assetIds = formData.getAll("assetIds").map(String);

  const album = await prisma.album.findFirst({
    where: { id: albumId, persona: { organizationId: ctx.organizationId } },
    select: { id: true, name: true, personaId: true, items: { select: { assetId: true } } },
  });
  if (!album) return { ok: false, error: "Album not found." };

  const owned = await assertOwned(ctx, assetIds);
  if (!owned || owned.personaId !== album.personaId) {
    return { ok: false, error: "These media belong to another persona." };
  }

  const already = new Set(album.items.map((item) => item.assetId));
  const fresh = assetIds.filter((id) => !already.has(id));
  if (fresh.length === 0) {
    return { ok: true, albumId: album.id, message: "Already in the album." };
  }

  await prisma.albumItem.createMany({
    data: fresh.map((assetId, index) => ({
      albumId: album.id,
      assetId,
      position: already.size + index,
    })),
  });
  await prisma.album.update({ where: { id: album.id }, data: { updatedAt: new Date() } });

  revalidatePath("/library");
  return {
    ok: true,
    albumId: album.id,
    message: `${fresh.length} added to “${album.name}”.`,
  };
}

export async function renameAlbumAction(
  _prev: AlbumResult | null,
  formData: FormData,
): Promise<AlbumResult> {
  const ctx = await requireOrgContext();

  const albumId = String(formData.get("albumId") ?? "");
  const parsed = nameSchema.safeParse(formData.get("name") ?? "");
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  const updated = await prisma.album.updateMany({
    where: { id: albumId, persona: { organizationId: ctx.organizationId } },
    data: { name: parsed.data },
  });
  if (updated.count === 0) return { ok: false, error: "Album not found." };

  revalidatePath("/library");
  return { ok: true, albumId, message: "Renamed." };
}

/** Retire un média d'un album. Le média lui-même n'est pas touché. */
export async function removeFromAlbumAction(
  albumId: string,
  assetId: string,
): Promise<AlbumResult> {
  const ctx = await requireOrgContext();

  const album = await prisma.album.findFirst({
    where: { id: albumId, persona: { organizationId: ctx.organizationId } },
    select: { id: true },
  });
  if (!album) return { ok: false, error: "Album not found." };

  await prisma.albumItem.deleteMany({ where: { albumId, assetId } });
  revalidatePath("/library");
  return { ok: true, albumId, message: "Removed from the album." };
}

/**
 * Supprime un album.
 *
 * Les médias restent en bibliothèque: un album est un regroupement, pas un
 * contenant. Le confondre ferait perdre des fichiers pour un simple rangement.
 */
export async function deleteAlbumAction(albumId: string): Promise<AlbumResult> {
  const ctx = await requireOrgContext();

  const deleted = await prisma.album.deleteMany({
    where: { id: albumId, persona: { organizationId: ctx.organizationId } },
  });
  if (deleted.count === 0) return { ok: false, error: "Album not found." };

  revalidatePath("/library");
  return { ok: true, albumId, message: "Album deleted. The media stay in the library." };
}
