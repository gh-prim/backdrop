import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listPublications } from "@/lib/publications";
import { groupPublications } from "@/lib/publication-groups";
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
        description={`${groupPublications(publications).length} publication${groupPublications(publications).length > 1 ? "s" : ""}`}
        actions={
          // `nativeButton={false}`: le rendu est un <a>, et prétendre le
          // contraire retire à Base UI la sémantique native.
          <Button size="sm" nativeButton={false} render={<Link href="/composer" />}>
            <Plus />
            New publication
          </Button>
        }
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
          cards={groupPublications(publications).map((group) => ({
            id: group.id,
            name: group.name,
            kind: group.kind,
            status: group.status,
            caption: group.caption,
            scheduledAt: group.scheduledAt.toISOString(),
            publishedAt: group.publishedAt?.toISOString() ?? null,
            version: group.version,
            author: group.author,
            persona: group.persona,
            itemCount: group.itemCount,
            rating: group.rating,
            coverVariantId: group.coverVariantId,
            archived: group.archived,
            legs: group.legs.map((leg) => ({
              platform: leg.platform,
              status: leg.status,
              destination: leg.destination,
              failureReason: leg.failureReason,
              remoteId: leg.remoteId,
              starPrice: leg.starPrice,
            })),
          }))}
        />
      )}
    </div>
  );
}
