import "server-only";
import { prisma } from "@/lib/db";
import type { OrgContext } from "@/lib/session";

/** Vignettes composant la mosaïque d'un album. */
export const MOSAIC_TILES = 4;

/**
 * Albums d'une persona, avec de quoi dessiner leur mosaïque.
 *
 * Un album groupe des **Assets** et non des Variants: le ratio se choisit à
 * l'envoi. Pour l'affichage on prend la première variante venue de chaque
 * média — une vignette n'a pas à respecter le cadrage final.
 */
export async function listAlbums(ctx: OrgContext, personaId?: string) {
  const albums = await prisma.album.findMany({
    // Scope serveur: l'organisation vient de la session (9.6).
    where: {
      persona: {
        organizationId: ctx.organizationId,
        ...(personaId ? { id: personaId } : {}),
      },
    },
    select: {
      id: true,
      name: true,
      personaId: true,
      updatedAt: true,
      persona: { select: { name: true } },
      items: {
        orderBy: { position: "asc" },
        select: {
          assetId: true,
          asset: {
            select: {
              rating: true,
              variants: { take: 1, select: { id: true } },
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  const RATINGS = ["SFW", "SUGGESTIVE", "NSFW"] as const;

  return albums.map((album) => ({
    id: album.id,
    name: album.name,
    personaId: album.personaId,
    personaName: album.persona.name,
    count: album.items.length,
    // Le rating d'un album est le plus élevé de ses médias: flouter selon la
    // mosaïque laisserait passer un média sensible caché derrière trois
    // vignettes anodines.
    rating: album.items.reduce<"SFW" | "SUGGESTIVE" | "NSFW">(
      (max, item) =>
        RATINGS.indexOf(item.asset.rating) > RATINGS.indexOf(max)
          ? item.asset.rating
          : max,
      "SFW",
    ),
    mosaic: album.items
      .map((item) => item.asset.variants[0]?.id)
      .filter((id): id is string => Boolean(id))
      .slice(0, MOSAIC_TILES),
  }));
}

/**
 * Médias d'un album pour un ratio donné, prêts à composer.
 *
 * Un média sans variante dans ce ratio est **écarté et signalé**: l'envoyer
 * dans un autre cadrage donnerait un carrousel bancal, et le taire ferait
 * découvrir l'absence au moment de l'envoi.
 */
export async function resolveAlbum(
  ctx: OrgContext,
  albumId: string,
  ratio: string,
) {
  const album = await prisma.album.findFirst({
    where: { id: albumId, persona: { organizationId: ctx.organizationId } },
    select: {
      name: true,
      items: {
        orderBy: { position: "asc" },
        select: {
          asset: {
            select: {
              id: true,
              name: true,
              variants: { where: { ratio }, select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!album) return null;

  const variantIds: string[] = [];
  const missing: string[] = [];

  for (const item of album.items) {
    const variant = item.asset.variants[0];
    if (variant) variantIds.push(variant.id);
    else missing.push(item.asset.name ?? item.asset.id);
  }

  return { name: album.name, variantIds, missing };
}

/** Ratios pour lesquels **tous** les médias de l'album ont une variante. */
export async function albumRatios(ctx: OrgContext, albumId: string) {
  const album = await prisma.album.findFirst({
    where: { id: albumId, persona: { organizationId: ctx.organizationId } },
    select: {
      items: {
        select: { asset: { select: { variants: { select: { ratio: true } } } } },
      },
    },
  });
  if (!album || album.items.length === 0) return [];

  const perAsset = album.items.map(
    (item) => new Set(item.asset.variants.map((variant) => variant.ratio)),
  );

  return [...perAsset[0]]
    .filter((ratio) => perAsset.every((ratios) => ratios.has(ratio)))
    .sort();
}
