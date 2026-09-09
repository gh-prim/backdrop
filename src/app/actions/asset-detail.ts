"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgContext } from "@/lib/session";
import { updateAssetDescription } from "@/lib/assets";
import { startIngestWorkflow } from "@/temporal/client";
import { prisma } from "@/lib/db";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const descriptionSchema = z.object({
  assetId: z.string().min(1),
  description: z.string().max(2000),
});

export async function updateAssetDescriptionAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();
  const parsed = descriptionSchema.safeParse({
    assetId: formData.get("assetId"),
    description: String(formData.get("description") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  try {
    await updateAssetDescription(ctx, parsed.data.assetId, parsed.data.description);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  revalidatePath(`/library/${parsed.data.assetId}`);
  return { ok: true, message: "Description enregistrée." };
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
    // Un workflow déjà lancé pour ce couple n'est pas une erreur.
    if (!message.includes("already started")) {
      return { ok: false, error: `Dérivation non démarrée: ${message}` };
    }
  }

  revalidatePath(`/library/${assetId}`);
  return { ok: true, message: `Dérivation ${ratio} lancée.` };
}
