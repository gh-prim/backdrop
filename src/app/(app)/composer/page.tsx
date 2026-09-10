import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listChannelStatus } from "@/lib/channels";
import { listPublishableVariants } from "@/lib/publications";
import { Card, CardContent } from "@/components/ui/card";
import { FixedHeightPage } from "@/components/tabs-shell";
import { ComposerForm } from "./composer-form";

export default async function ComposerPage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string }>;
}) {
  // Le calendrier ouvre le composeur sur un créneau choisi. La date arrive
  // donc en paramètre, et remplace la valeur par défaut.
  const { at } = await searchParams;
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const personaId = selectedId === ALL_PERSONAS ? personas[0]?.id : selectedId;

  if (!personaId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No persona yet. An owner can create one from Settings.
        </CardContent>
      </Card>
    );
  }

  const [channels, variants] = await Promise.all([
    listChannelStatus(ctx),
    listPublishableVariants(ctx, personaId),
  ]);

  return (
    <FixedHeightPage>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight">Composer</h1>
        <p className="text-sm text-muted-foreground">
          A channel&apos;s limits decide which media you can pick next.
        </p>
      </div>
      <ComposerForm
        initialScheduledAt={at}
        personaId={personaId}
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
    </FixedHeightPage>
  );
}
