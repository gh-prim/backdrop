import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listAssets } from "@/lib/assets";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MediaThumb, BlurPreferenceToggle } from "@/components/media-thumb";
import { UploadForm } from "./upload-form";

export default async function LibraryPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const assets = await listAssets(
    ctx,
    selectedId === ALL_PERSONAS ? undefined : selectedId,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-bold">Library</h1>
        <BlurPreferenceToggle />
      </div>

      <Card>
        <CardContent className="pt-6">
          <UploadForm personas={personas} defaultPersonaId={selectedId} />
        </CardContent>
      </Card>

      {assets.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aucun Asset. Uploadez un fichier: les Variants 4:5 et 9:16 sont dérivés
            automatiquement, et poussés sur R2 uniquement si l&apos;Asset est SFW.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {assets.map((asset) => (
            <Card key={asset.id} className="overflow-hidden">
              <CardContent className="space-y-2 p-3">
                {asset.variants.length > 0 ? (
                  <div className="grid grid-cols-2 gap-1">
                    {asset.variants.map((variant) => (
                      <MediaThumb
                        key={variant.id}
                        variantId={variant.id}
                        rating={asset.rating}
                        ratio={variant.ratio}
                        className="aspect-[4/5]"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex aspect-[4/5] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                    Dérivation en cours…
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  <Badge
                    variant={asset.rating === "SFW" ? "secondary" : "destructive"}
                    className="h-4 px-1 text-[9px]"
                  >
                    {asset.rating}
                  </Badge>
                  <span>{asset.createdBy.name}</span>
                  <span className="ml-auto">
                    {asset.variants.filter((v) => v.r2Key).length}/{asset.variants.length} sur R2
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
