import { proxyActivities, log } from "@temporalio/workflow";
import type * as activities from "../activities";

/**
 * Dérivation d'un Variant depuis un Asset (spec 7.2).
 *
 * ffmpeg -> disque local -> R2 si SFW. Le push R2 n'a lieu que pour un Asset
 * SFW, et c'est l'activité elle-même qui relit le rating en base: le workflow
 * ne décide pas de ce garde-fou (section 5).
 */

const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 3, initialInterval: "5 seconds" },
});

export type IngestVariantInput = { assetId: string; ratio: string };

export type IngestVariantResult = {
  variantId: string;
  localPath: string;
  r2Key: string | null;
  skipped: "not_sfw" | "no_r2_config" | null;
};

export async function ingestVariant(
  input: IngestVariantInput,
): Promise<IngestVariantResult> {
  const asset = await act.loadAssetForIngest(input.assetId);
  await act.probeMedia(asset.localPath);

  const { localPath } = await act.transcodeVariant({
    sourcePath: asset.localPath,
    ratio: input.ratio,
    outputBase: `variants/${asset.personaId}/${input.assetId}-${input.ratio.replace(":", "x")}`,
  });

  const { variantId } = await act.createVariantRecord({
    assetId: input.assetId,
    ratio: input.ratio,
    localPath,
  });

  const upload = await act.uploadVariantToR2(variantId);
  if (upload.skipped === "not_sfw") {
    log.info("Variant non poussé sur R2: l'Asset n'est pas SFW", { variantId });
  } else if (upload.skipped === "no_r2_config") {
    log.warn("R2 non configuré: le Variant n'aura pas d'URL publique", { variantId });
  }

  return { variantId, localPath, r2Key: upload.r2Key, skipped: upload.skipped };
}
