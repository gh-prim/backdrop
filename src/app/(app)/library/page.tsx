import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listAssets } from "@/lib/assets";
import { BlurPreferenceToggle } from "@/components/media-thumb";
import { PageHeader } from "@/components/page-header";
import { FixedHeightPage, TabsShell } from "@/components/tabs-shell";
import { UploadDialog } from "./upload-dialog";
import { AssetGrid } from "./asset-grid";
import { listAlbums } from "@/lib/albums";
import { AlbumShelf } from "./album-shelf";

/**
 * Deux vues sur le même fonds, jamais deux fonds.
 *
 * L'onglet Library montre tout; l'onglet Albums montre les regroupements. Un
 * média rangé dans un album reste donc dans Library: un album groupe, il ne
 * déplace pas — sans quoi on chercherait longtemps une image « disparue ».
 */
export default async function LibraryPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const scope = selectedId === ALL_PERSONAS ? undefined : selectedId;
  const [assets, albums] = await Promise.all([
    listAssets(ctx, scope),
    listAlbums(ctx, scope),
  ]);

  const personaNames = new Map(personas.map((persona) => [persona.id, persona.name]));

  return (
    <FixedHeightPage>
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

      <TabsShell
        tabs={[
          {
            value: "media",
            label: "Library",
            content: (
              <AssetGrid
                albums={albums.map((album) => ({
                  id: album.id,
                  name: album.name,
                  personaId: album.personaId,
                  count: album.count,
                }))}
                assets={assets.map((asset) => ({
                  id: asset.id,
                  rating: asset.rating,
                  personaName: personaNames.get(asset.personaId) ?? "",
                  authorName: asset.createdBy.name,
                  createdAt: asset.createdAt.toLocaleDateString("en-GB", {
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
            ),
          },
          {
            value: "albums",
            label: `Albums${albums.length > 0 ? ` · ${albums.length}` : ""}`,
            content: (
              <AlbumShelf
                albums={albums.map((album) => ({
                  id: album.id,
                  name: album.name,
                  personaName: album.personaName,
                  count: album.count,
                  rating: album.rating,
                  mosaic: album.mosaic,
                }))}
              />
            ),
          },
        ]}
      />
    </FixedHeightPage>
  );
}
