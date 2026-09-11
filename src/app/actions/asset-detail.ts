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
