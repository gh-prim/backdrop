import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/session";
import { getAssetDetail } from "@/lib/assets";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssetOriginal } from "./asset-original";
import { DescriptionForm } from "./description-form";
import { VariantList } from "./variant-list";
import { UsageList } from "./usage-list";

function humanSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default async function AssetPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const ctx = await requireOrgContext();
  const { assetId } = await params;
  const asset = await getAssetDetail(ctx, assetId);
  if (!asset) notFound();

  const isVideo = /\.(mp4|mov|m4v)$/i.test(asset.localPath);

  const metadata: [string, string][] = [
    ["Persona", `${asset.persona.name} @${asset.persona.handle}`],
    [
      "Dimensions",
      asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—",
    ],
    ["Poids", humanSize(asset.sizeBytes)],
    [
      "Durée",
      asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)} s` : "—",
    ],
    ["Type", asset.mimeType ?? "—"],
    ["Ajouté le", asset.createdAt.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })],
    ["Par", asset.createdBy.name],
    ["Empreinte", `${asset.sha256.slice(0, 16)}…`],
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Library
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <AssetOriginal
            assetId={asset.id}
            rating={asset.rating}
            isVideo={isVideo}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Variants</CardTitle>
            </CardHeader>
            <CardContent>
              <VariantList
                assetId={asset.id}
                rating={asset.rating}
                variants={asset.variants.map((variant) => ({
                  id: variant.id,
                  ratio: variant.ratio,
                  onR2: Boolean(variant.r2Key),
                  onTelegram: variant.tgSourceMessageId !== null,
                  onFanvue: Boolean(variant.fvMediaUuid),
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Utilisations</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageList
                usages={asset.usages.map((usage) => ({
                  publicationId: usage.publication.id,
                  name: usage.publication.name,
                  kind: usage.publication.kind,
                  status: usage.publication.status,
                  platform: usage.publication.channelAccount.platform,
                  ratio: usage.variant.ratio,
                  position: usage.position,
                  scheduledAt: usage.publication.scheduledAt.toISOString(),
                  publishedAt: usage.publication.publishedAt?.toISOString() ?? null,
                  remoteId: usage.publication.remoteId,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Badge
                variant={asset.rating === "SFW" ? "secondary" : "destructive"}
                className="text-xs"
              >
                {asset.rating}
              </Badge>
              {/* Le rating est immuable (9.4): l'écran doit dire pourquoi, et
                  donner le chemin de correction, plutôt qu'un champ grisé. */}
              <p className="text-xs text-muted-foreground">
                Le rating est définitif. Il commande les canaux autorisés et le
                passage par R2, et le modifier après coup rendrait publiable
                ailleurs un média déjà classé. Pour le corriger, réuploadez le
                fichier avec le bon rating: l&apos;original reste intact.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionForm
                assetId={asset.id}
                description={asset.description ?? ""}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Métadonnées</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-xs">
                {metadata.map(([label, value]) => (
                  <div key={label} className="flex gap-3">
                    <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 flex-1 break-words font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
