import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listChannelStatus } from "@/lib/channels";
import { listPublishableVariants } from "@/lib/publications";
import { resolvePreselection } from "@/lib/composer-preselect";
import { ComposerModal } from "@/components/composer-modal";
import { ComposerForm } from "./composer-form";

/**
 * Le composeur, monté dans son modal.
 *
 * Partagé par la route interceptée et par `/composer`: les deux rendent
 * exactement la même chose, ce qui est la seule façon de garantir qu'il n'y a
 * pas de version « page » qui dérive de son côté.
 */
export async function ComposerPanel({
  at,
  assetId,
  albumId,
  ratio,
}: {
  at?: string;
  /** Ouverture depuis un média de la bibliothèque. */
  assetId?: string;
  /** Ouverture depuis un album, éventuellement dans un cadrage donné. */
  albumId?: string;
  ratio?: string;
}) {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const personaId = selectedId === ALL_PERSONAS ? personas[0]?.id : selectedId;
  if (!personaId) return null;

  const [channels, variants, preselection] = await Promise.all([
    listChannelStatus(ctx),
    listPublishableVariants(ctx, personaId),
    resolvePreselection(ctx, { assetId, albumId, ratio }),
  ]);

  return (
    <ComposerModal>
      <ComposerForm
        initialScheduledAt={at}
        initialVariantIds={preselection.variantIds}
        initialSelectionLabel={preselection.label}
        initialSelectionMissing={preselection.missing}
        personaId={personaId}
        personaName={personas.find((persona) => persona.id === personaId)?.name ?? ""}
        channels={channels
          .filter((channel) => channel.personaId === personaId)
          .map((channel) => ({
            id: channel.id,
            platform: channel.platform,
            maxRating: channel.maxRating,
            state: channel.state,
          }))}
        variants={variants.map((variant) => ({
          id: variant.id,
          ratio: variant.ratio,
          rating: variant.asset.rating,
          hasPublicUrl: Boolean(variant.r2Key),
          isVideo: /\.(mp4|mov|m4v)$/i.test(variant.localPath),
        }))}
      />
    </ComposerModal>
  );
}
