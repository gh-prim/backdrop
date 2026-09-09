"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Rating } from "@prisma/client";
import { requireOrgContext } from "@/lib/session";
import { createAssetFromUpload } from "@/lib/assets";
import { startIngestWorkflow } from "@/temporal/client";

const schema = z.object({
  personaId: z.string().min(1, "Persona requise."),
  rating: z.enum(Rating),
  ratios: z.array(z.string()).min(1, "Au moins un ratio."),
});

export type ActionResult =
  | { ok: true; assetId: string; message: string }
  | { ok: false; error: string };

/**
 * Upload d'un Asset, puis dérivation des Variants par `ingestVariant`.
 *
 * Le rating est choisi à l'upload et devient immuable (9.4). Il commande tout
 * le reste: recadrage, push R2, canaux éligibles.
 */
export async function uploadAssetAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOrgContext();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Aucun fichier." };
  }

  const parsed = schema.safeParse({
    personaId: formData.get("personaId"),
    rating: formData.get("rating"),
    ratios: formData.getAll("ratios").map(String),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  const result = await createAssetFromUpload(ctx, {
    personaId: parsed.data.personaId,
    rating: parsed.data.rating,
    file,
  });
  if (!result.ok) return result;

  const started: string[] = [];
  for (const ratio of parsed.data.ratios) {
    try {
      await startIngestWorkflow({ assetId: result.assetId, ratio });
      started.push(ratio);
    } catch (error) {
      // Un workflow déjà lancé pour ce couple (asset, ratio) n'est pas une
      // erreur: l'identifiant de workflow est précisément là pour ça.
      if (!(error as Error).message?.includes("already started")) {
        return {
          ok: false,
          error: `Asset enregistré, mais la dérivation ${ratio} n'a pas démarré: ${(error as Error).message}`,
        };
      }
    }
  }

  revalidatePath("/library");
  return {
    ok: true,
    assetId: result.assetId,
    message: result.deduplicated
      ? "Fichier déjà présent, dérivations relancées."
      : `Asset enregistré, dérivation lancée pour ${started.join(", ")}.`,
  };
}
