import Link from "next/link";
import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listPublications } from "@/lib/publications";
import { Card, CardContent } from "@/components/ui/card";

const RATINGS = ["SFW", "SUGGESTIVE", "NSFW"] as const;
import { PageHeader } from "@/components/page-header";
import { PublicationsGrid } from "./publications-grid";

export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const ctx = await requireOrgContext();
  const { archived } = await searchParams;
  const showingArchived = archived === "1";

  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const publications = await listPublications(
    ctx,
    selectedId === ALL_PERSONAS ? undefined : selectedId,
    { includeArchived: showingArchived },
  ).then((rows) =>
    // L'archive est une vue à part: on n'y mélange pas ce qui est en cours.
    showingArchived ? rows.filter((row) => row.archivedAt !== null) : rows,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={showingArchived ? "Archive" : "Publications"}
        description={`${publications.length} publication${publications.length > 1 ? "s" : ""}`}
      />
      {publications.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {showingArchived ? (
              <>
                <p>Nothing archived yet.</p>
                {/* La bascule vit dans la grille, qui ne s'affiche pas ici:
                    sans cette sortie, une archive vide serait sans retour. */}
                <Link
                  href="/publications"
                  className="mt-2 inline-block underline underline-offset-4"
                >
                  Back to publications
                </Link>
              </>
            ) : (
              "No publications yet. The Composer schedules one."
            )}
          </CardContent>
        </Card>
      ) : (
        <PublicationsGrid
          showingArchived={showingArchived}
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
            archived: publication.archivedAt !== null,
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
