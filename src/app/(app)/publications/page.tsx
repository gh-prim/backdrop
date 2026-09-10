import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listPublications } from "@/lib/publications";
import { Card, CardContent } from "@/components/ui/card";

const RATINGS = ["SFW", "SUGGESTIVE", "NSFW"] as const;
import { PageHeader } from "@/components/page-header";
import { PublicationsGrid } from "./publications-grid";

export default async function PublicationsPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const publications = await listPublications(
    ctx,
    selectedId === ALL_PERSONAS ? undefined : selectedId,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Publications"
        description={`${publications.length} publication${publications.length > 1 ? "s" : ""}`}
      />
      {publications.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No publications yet. The Composer schedules one.
          </CardContent>
        </Card>
      ) : (
        <PublicationsGrid
          cards={publications.map((publication) => ({
            id: publication.id,
            name: publication.name,
            kind: publication.kind,
            status: publication.status,
            caption: publication.copy,
            scheduledAt: publication.scheduledAt.toISOString(),
            publishedAt: publication.publishedAt?.toISOString() ?? null,
            remoteId: publication.remoteId,
            failureReason: publication.failureReason,
            version: publication.version,
            author: publication.createdBy.name,
            platform: publication.channelAccount.platform,
            persona: publication.channelAccount.persona.name,
            itemCount: publication.items.length,
            // Le rating de la tuile est le plus élevé du lot: flouter selon la
            // couverture laisserait passer un média sensible derrière une
            // première image anodine.
            rating: publication.items.reduce<"SFW" | "SUGGESTIVE" | "NSFW">(
              (max, item) =>
                RATINGS.indexOf(item.variant.asset.rating) > RATINGS.indexOf(max)
                  ? item.variant.asset.rating
                  : max,
              "SFW",
            ),
            coverVariantId: publication.items[0]?.variant.id ?? null,
            coverRatio: publication.items[0]?.variant.ratio ?? null,
            starPrice: publication.starPrice,
            targetLabel: publication.targetLabel,
            // Telegram nomme sa destination; ailleurs, le compte de la
            // persona sur la plateforme est la seule destination possible.
            destination:
              publication.targetLabel ??
              `${publication.channelAccount.platform.charAt(0)}${publication.channelAccount.platform.slice(1).toLowerCase()} · ${publication.channelAccount.persona.name}`,
          }))}
        />
      )}
    </div>
  );
}
