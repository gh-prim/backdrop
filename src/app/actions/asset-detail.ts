"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Rating } from "@prisma/client";
import { requireOrgContext } from "@/lib/session";
import { AssetInUseError, deleteAsset, updateAsset } from "@/lib/assets";
import { startIngestWorkflow } from "@/temporal/client";
import { prisma } from "@/lib/db";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const updateSchema = z.object({
  assetId: z.string().min(1),
  name: z.string().max(120),
  description: z.string().max(2000),
  rating: z.enum(Rating),
});

/**
 * Enregistre nom, description et classification.
 *
 * Le rejet du trigger de rating remonte ici tel quel: c'est la base qui
 * tranche, pas une vérification applicative (9.1).
 */
export async function updateAssetAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();
  const parsed = updateSchema.safeParse({
    assetId: formData.get("assetId"),
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    rating: formData.get("rating"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const { removedFromR2 } = await updateAsset(ctx, parsed.data.assetId, {
      name: parsed.data.name,
      description: parsed.data.description,
      rating: parsed.data.rating,
    });

    revalidatePath(`/library/${parsed.data.assetId}`);
    revalidatePath("/library");

    return {
      ok: true,
      message:
        removedFromR2 > 0
          ? `Saved. ${removedFromR2} file${removedFromR2 > 1 ? "s" : ""} removed from R2: non-SFW media keeps no public URL.`
          : "Saved.",
    };
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (message.includes("rating_violation")) {
      return {
        ok: false,
        error:
          "Refused by the database: this media is used by a publication on a channel that does not accept this rating. Cancel that publication before reclassifying.",
      };
    }
    return { ok: false, error: message || "Could not save." };
  }
}

export async function deleteAssetAction(assetId: string): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  try {
    await deleteAsset(ctx, assetId);
  } catch (error) {
    if (error instanceof AssetInUseError) return { ok: false, error: error.message };
    return { ok: false, error: (error as Error).message };
  }

  revalidatePath("/library");
  redirect("/library");
}

/**
 * Dérive un ratio supplémentaire depuis l'original.
 *
 * Toujours à partir de l'Asset, jamais d'un Variant: recadrer un recadrage
 * perdrait de l'image à chaque passage.
 */
export async function deriveVariantAction(
  assetId: string,
  ratio: string,
  /** Position verticale du recadrage, 0 (haut) à 100 (bas). */
  cropOffset?: number,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, persona: { organizationId: ctx.organizationId } },
    select: { id: true },
  });
  if (!asset) return { ok: false, error: "Asset not found." };

  try {
    await startIngestWorkflow({ assetId, ratio, cropOffset });
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!message.includes("already started")) {
      return { ok: false, error: `Derivation did not start: ${message}` };
    }
  }

  revalidatePath(`/library/${assetId}`);
  return {
    ok: true,
    message:
      cropOffset === undefined
        ? `${ratio} derivation started.`
        // La dérivation est asynchrone: annoncer « recadré » serait mentir
        // d'une poignée de secondes.
        : `Re-cropping ${ratio} at ${cropOffset}%. It replaces the current file.`,
  };
}

/**
 * Où en est le recadrage d'un Variant.
 *
 * La re-dérivation passe par Temporal: elle rend la main avant que ffmpeg
 * n'ait écrit quoi que ce soit. L'interface a donc besoin de savoir quand le
 * fichier a vraiment changé, sinon elle afficherait l'ancien cadrage en
 * prétendant le contraire. `cropOffset` n'est écrit qu'à la fin: le voir
 * bouger, c'est la preuve que le nouveau fichier existe.
 */
export async function variantCropOffsetAction(
  variantId: string,
): Promise<{ cropOffset: number | null } | null> {
  const ctx = await requireOrgContext();

  const variant = await prisma.variant.findFirst({
    where: {
      id: variantId,
      asset: { persona: { organizationId: ctx.organizationId } },
    },
    select: { cropOffset: true },
  });

  return variant ?? null;
}

/**
 * La Variant d'un Asset dans un cadrage donné, quitte à la fabriquer.
 *
 * Chaque canal veut son propre cadre: Instagram ramène tout au plus haut de
 * son fil, Telegram et Fanvue affichent ce qu'on leur envoie. Envoyer la même
 * image partout revient à laisser Instagram couper au hasard. L'écran de
 * confirmation demande donc, canal par canal, « cette photo, dans ce cadre,
 * à cette hauteur » — et c'est ici que ça se résout.
 *
 * Rend `null` sans attendre si la dérivation est en route: l'appelant
 * rappellera. Une activité longue tenue ouverte derrière une Server Action
 * bloquerait une connexion pour rien.
 */
export async function resolveVariantAction(
  assetId: string,
  ratio: string,
  cropOffset?: number,
): Promise<{ variantId: string } | null> {
  const ctx = await requireOrgContext();

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, persona: { organizationId: ctx.organizationId } },
    select: { id: true },
  });
  if (!asset) return null;

  const existing = await prisma.variant.findFirst({
    where: { assetId, ratio },
    select: { id: true, cropOffset: true },
  });

  // Le cadrage demandé est déjà celui du fichier: rien à recalculer.
  const wanted = cropOffset ?? 50;
  if (existing && (existing.cropOffset ?? 50) === wanted) {
    return { variantId: existing.id };
  }

  try {
    await startIngestWorkflow({ assetId, ratio, cropOffset });
  } catch (error) {
    // « already started » veut dire qu'une dérivation identique est en cours:
    // c'est l'appel précédent du même écran, pas une erreur.
    const message = (error as Error).message ?? "";
    if (!message.includes("already started")) throw error;
  }

  return null;
}
