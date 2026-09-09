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
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
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
          ? `Enregistré. ${removedFromR2} fichier${removedFromR2 > 1 ? "s" : ""} retiré${removedFromR2 > 1 ? "s" : ""} de R2: un média non SFW ne garde pas d'URL publique.`
          : "Enregistré.",
    };
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (message.includes("rating_violation")) {
      return {
        ok: false,
        error:
          "Refusé par la base: ce média est utilisé par une publication sur un canal qui n'accepte pas ce rating. Annulez la publication avant de le reclasser.",
      };
    }
    return { ok: false, error: message || "Enregistrement impossible." };
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
): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, persona: { organizationId: ctx.organizationId } },
    select: { id: true },
  });
  if (!asset) return { ok: false, error: "Asset introuvable." };

  try {
    await startIngestWorkflow({ assetId, ratio });
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!message.includes("already started")) {
      return { ok: false, error: `Dérivation non démarrée: ${message}` };
    }
  }

  revalidatePath(`/library/${assetId}`);
  return { ok: true, message: `Dérivation ${ratio} lancée.` };
}
