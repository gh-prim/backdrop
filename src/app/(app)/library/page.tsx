import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listAssets } from "@/lib/assets";
import { BlurPreferenceToggle } from "@/components/media-thumb";
import { PageHeader } from "@/components/page-header";
import { UploadDialog } from "./upload-dialog";
import { AssetGrid } from "./asset-grid";

export default async function LibraryPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const assets = await listAssets(
    ctx,
    selectedId === ALL_PERSONAS ? undefined : selectedId,
  );

  const personaNames = new Map(personas.map((persona) => [persona.id, persona.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Library"
        description="Ratings drive which channels are allowed and whether a file reaches R2."
        actions={
          <>
            <BlurPreferenceToggle />
            <UploadDialog personas={personas} defaultPersonaId={selectedId} />
          </>
        }
      />

      <AssetGrid
        assets={assets.map((asset) => ({
          id: asset.id,
          rating: asset.rating,
          personaName: personaNames.get(asset.personaId) ?? "",
          authorName: asset.createdBy.name,
          createdAt: asset.createdAt.toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "short",
          }),
          isVideo: /\.(mp4|mov|m4v)$/i.test(asset.localPath),
          description: asset.description,
          usageCount: asset.variants.reduce(
            (total, variant) => total + variant._count.publicationItems,
            0,
          ),
          variants: asset.variants.map((variant) => ({
            id: variant.id,
            ratio: variant.ratio,
            onR2: Boolean(variant.r2Key),
          })),
        }))}
      />
    </div>
  );
}
