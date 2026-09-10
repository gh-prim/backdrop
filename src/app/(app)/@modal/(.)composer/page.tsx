import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listChannelStatus } from "@/lib/channels";
import { listPublishableVariants } from "@/lib/publications";
import { ComposerForm } from "../../composer/composer-form";
import { ComposerModal } from "./composer-modal";

/**
 * Composeur en modal, ouvert par-dessus la page courante.
 *
 * Composer est une action, pas une destination: on compose depuis un créneau
 * du calendrier, depuis le dashboard, depuis la bibliothèque — et on veut
 * revenir exactement d'où l'on vient.
 *
 * Route interceptée plutôt que simple modal: `/composer` reste une URL
 * partageable, et un rafraîchissement rend la page pleine plutôt que de perdre
 * la composition en cours.
 */
export default async function ComposerModalPage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string }>;
}) {
  const ctx = await requireOrgContext();
  const { at } = await searchParams;

  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const personaId = selectedId === ALL_PERSONAS ? personas[0]?.id : selectedId;
  if (!personaId) return null;

  const [channels, variants] = await Promise.all([
    listChannelStatus(ctx),
    listPublishableVariants(ctx, personaId),
  ]);

  return (
    <ComposerModal>
      <ComposerForm
        initialScheduledAt={at}
        personaName={personas.find((p) => p.id === personaId)?.name ?? ""}
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
