import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listPublications } from "@/lib/publications";
import { Card, CardContent } from "@/components/ui/card";
import { PublicationsTable } from "./publications-table";

export default async function PublicationsPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const publications = await listPublications(
    ctx,
    selectedId === ALL_PERSONAS ? undefined : selectedId,
  );

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Publications</h1>
      {publications.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aucune publication. Le Composer en programme une.
          </CardContent>
        </Card>
      ) : (
        <PublicationsTable
          rows={publications.map((publication) => ({
            id: publication.id,
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
            rating: publication.items.reduce<string>(
              (max, item) =>
                ["SFW", "SUGGESTIVE", "NSFW"].indexOf(item.variant.asset.rating) >
                ["SFW", "SUGGESTIVE", "NSFW"].indexOf(max)
                  ? item.variant.asset.rating
                  : max,
              "SFW",
            ),
          }))}
        />
      )}
    </div>
  );
}
