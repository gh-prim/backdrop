import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listChannelStatus } from "@/lib/channels";
import { listPublishableVariants } from "@/lib/publications";
import { Card, CardContent } from "@/components/ui/card";
import { ComposerForm } from "./composer-form";

export default async function ComposerPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const personaId = selectedId === ALL_PERSONAS ? personas[0]?.id : selectedId;

  if (!personaId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Aucune persona. Un owner peut en créer une depuis les Réglages.
        </CardContent>
      </Card>
    );
  }

  const [channels, variants] = await Promise.all([
    listChannelStatus(ctx),
    listPublishableVariants(ctx, personaId),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Composer</h1>
      <ComposerForm
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
        }))}
      />
    </div>
  );
}
