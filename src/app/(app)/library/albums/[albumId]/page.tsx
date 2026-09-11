import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus } from "lucide-react";
import { requireOrgContext } from "@/lib/session";
import { getAlbumDetail } from "@/lib/albums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FixedHeightPage } from "@/components/tabs-shell";
import { AlbumItems } from "./album-items";
import { AlbumProperties } from "./album-properties";

const RATING_RANK = { SFW: 0, SUGGESTIVE: 1, NSFW: 2 } as const;

/**
 * Contenu d'un album.
 *
 * Sa raison d'être est l'envoi: la page dit donc surtout dans quels cadrages
 * l'album part entier, et lesquels lui manquent — un ratio incomplet est ce
 * qui, sinon, se découvre au moment de composer.
 */
export default async function AlbumPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  const ctx = await requireOrgContext();
  const { albumId } = await params;
  const album = await getAlbumDetail(ctx, albumId);
  if (!album) notFound();

  // Le rating d'un album est le plus élevé de ses médias: c'est lui qui décide
  // des canaux atteignables, pas la moyenne rassurante des autres.
  const rating = album.items.reduce<"SFW" | "SUGGESTIVE" | "NSFW">(
    (max, item) =>
      RATING_RANK[item.asset.rating] > RATING_RANK[max] ? item.asset.rating : max,
    "SFW",
  );

  return (
    <FixedHeightPage>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Library
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-sm font-bold">{album.name}</h1>
        <Badge
          variant={rating === "SFW" ? "secondary" : "destructive"}
          className="h-5 px-1.5 text-[10px]"
        >
          {rating}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {album.items.length} media · {album.persona.name}
        </span>

        <Button
          size="sm"
          className="ml-auto"
          nativeButton={false}
          render={<Link href={`/composer?album=${album.id}`} />}
        >
          <CalendarPlus />
          Schedule this album
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-y-auto pr-1">
          <AlbumItems
            albumId={album.id}
            items={album.items.map((item) => ({
              assetId: item.asset.id,
              label:
                item.asset.name ||
                item.asset.description?.slice(0, 40) ||
                "Untitled media",
              rating: item.asset.rating,
              thumbVariantId: item.asset.variants[0]?.id ?? null,
              ratios: item.asset.variants.map((variant) => variant.ratio),
            }))}
          />
        </div>

        <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Album</CardTitle>
            </CardHeader>
            <CardContent>
              <AlbumProperties
                albumId={album.id}
                name={album.name}
                count={album.items.length}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Ratios</CardTitle>
            </CardHeader>
            <CardContent>
              {album.ratios.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No variant derived yet.
                </p>
              ) : (
                <dl className="space-y-1.5 text-xs">
                  {album.ratios.map(({ ratio, have, total }) => (
                    <div key={ratio} className="flex items-center gap-3">
                      <dt className="w-12 shrink-0 font-medium">{ratio}</dt>
                      <dd
                        className={
                          have === total
                            ? "text-muted-foreground"
                            : "text-destructive"
                        }
                      >
                        {have === total
                          ? "sendable as a whole"
                          : `${total - have} media missing`}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {/* Répéter la règle ici évite d'aller la redécouvrir dans le
                    composeur, une fois le ratio choisi. */}
                The composer only offers a ratio every media of the album has.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </FixedHeightPage>
  );
}
