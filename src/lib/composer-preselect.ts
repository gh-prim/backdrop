import "server-only";
import { prisma } from "@/lib/db";
import { albumRatios, resolveAlbum } from "@/lib/albums";
import type { OrgContext } from "@/lib/session";

/**
 * Médias pré-sélectionnés à l'ouverture du composeur.
 *
 * Programmer part souvent d'une image qu'on a sous les yeux, pas d'un
 * formulaire vide: la bibliothèque ouvre donc le composeur avec ce média —
 * ou cet album — déjà choisi.
 *
 * La résolution est **serveur**: un identifiant d'URL ne dit rien de qui a le
 * droit de le voir. Tout est contraint à l'organisation de la session (9.6),
 * et ce qui n'y appartient pas est traité comme inexistant.
 */
export type Preselection = {
  variantIds: string[];
  /** De quoi le dire à l'écran: « Album Vestiaire, 4 médias en 4:5 ». */
  label: string | null;
  /** Médias de l'album absents dans ce ratio, écartés et comptés. */
  missing: number;
};

const EMPTY: Preselection = { variantIds: [], label: null, missing: 0 };

export async function resolvePreselection(
  ctx: OrgContext,
  input: { assetId?: string; albumId?: string; ratio?: string },
): Promise<Preselection> {
  if (input.albumId) return fromAlbum(ctx, input.albumId, input.ratio);
  if (input.assetId) return fromAsset(ctx, input.assetId, input.ratio);
  return EMPTY;
}

async function fromAsset(
  ctx: OrgContext,
  assetId: string,
  ratio?: string,
): Promise<Preselection> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, persona: { organizationId: ctx.organizationId } },
    select: {
      name: true,
      variants: { select: { id: true, ratio: true }, orderBy: { ratio: "asc" } },
    },
  });
  if (!asset || asset.variants.length === 0) return EMPTY;

  // Le ratio demandé s'il existe, sinon le premier: l'opérateur ajustera à
  // l'étape Media, où le choix est visible.
  const chosen =
    asset.variants.find((variant) => variant.ratio === ratio) ?? asset.variants[0];

  return {
    variantIds: [chosen.id],
    label: `${asset.name || "Media"} · ${chosen.ratio}`,
    missing: 0,
  };
}

async function fromAlbum(
  ctx: OrgContext,
  albumId: string,
  ratio?: string,
): Promise<Preselection> {
  // Sans ratio explicite, on prend le premier que **tous** les médias
  // possèdent: c'est le seul qui parte entier.
  const usable = await albumRatios(ctx, albumId);
  const chosen = ratio && usable.includes(ratio) ? ratio : usable[0];
  if (!chosen) return EMPTY;

  const resolved = await resolveAlbum(ctx, albumId, chosen);
  if (!resolved) return EMPTY;

  return {
    variantIds: resolved.variantIds,
    label: `${resolved.name} · ${resolved.variantIds.length} media · ${chosen}`,
    missing: resolved.missing.length,
  };
}
