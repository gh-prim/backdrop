"use server";

import { requireOrgContext } from "@/lib/session";
import { albumRatios, listAlbums, resolveAlbum } from "@/lib/albums";

export type AlbumChoice = {
  id: string;
  name: string;
  count: number;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  mosaic: string[];
  /** Ratios pour lesquels **tous** les médias ont une variante. */
  ratios: string[];
};

/** Albums d'une persona, avec les ratios réellement envoyables. */
export async function listAlbumChoicesAction(
  personaId: string,
): Promise<AlbumChoice[]> {
  const ctx = await requireOrgContext();
  const albums = await listAlbums(ctx, personaId);

  return Promise.all(
    albums.map(async (album) => ({
      id: album.id,
      name: album.name,
      count: album.count,
      rating: album.rating,
      mosaic: album.mosaic,
      ratios: await albumRatios(ctx, album.id),
    })),
  );
}

export type AlbumResolution =
  | { ok: true; variantIds: string[]; missing: string[] }
  | { ok: false; error: string };

/**
 * Traduit un album en variantes, pour un ratio donné.
 *
 * Un média sans variante dans ce ratio est écarté **et signalé**: l'envoyer
 * dans un autre cadrage donnerait un carrousel bancal, et le taire ferait
 * découvrir l'absence au moment de l'envoi.
 */
export async function resolveAlbumAction(
  albumId: string,
  ratio: string,
): Promise<AlbumResolution> {
  const ctx = await requireOrgContext();
  const resolved = await resolveAlbum(ctx, albumId, ratio);
  if (!resolved) return { ok: false, error: "Album not found." };

  if (resolved.variantIds.length === 0) {
    return { ok: false, error: `No media of “${resolved.name}” exists in ${ratio}.` };
  }

  return { ok: true, variantIds: resolved.variantIds, missing: resolved.missing };
}
