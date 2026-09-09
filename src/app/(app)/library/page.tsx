import { requireOrgContext } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";

export default async function LibraryPage() {
  await requireOrgContext();
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Library</h1>
      <Card>
        <CardContent className="space-y-2 py-8 text-center text-sm text-muted-foreground">
          <p>
            Grille des Assets et Variants, filtres par rating et par canal de destination.
          </p>
          <p className="text-xs">
            Arrive en phase 1 avec l&apos;upload et ffmpeg. Les vignettes NSFW et
            SUGGESTIVE y seront floutées par défaut.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
