import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listChannelStatus } from "@/lib/channels";
import { listPublishableVariants } from "@/lib/publications";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
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
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Composer"
        description="Schedule, name, channels, media: a channel's limits decide which media you can pick next."
      />
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
          isVideo: /\.(mp4|mov|m4v)$/i.test(variant.localPath),
        }))}
      />
    </div>
  );
}
