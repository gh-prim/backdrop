import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/session";
import { getAssetDetail } from "@/lib/assets";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FixedHeightPage, TabsShell } from "@/components/tabs-shell";
import { AssetOriginal } from "./asset-original";
import { PropertiesForm } from "./properties-form";
import { VariantList } from "./variant-list";
import { UsageList } from "./usage-list";

function humanSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    ["Dimensions", asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"],
    ["Size", humanSize(asset.sizeBytes)],
    ["Duration", asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)} s` : "—"],
    ["Type", asset.mimeType ?? "—"],
    [
      "Added",
      asset.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
    ],
    ["By", asset.createdBy.name],
    ["Checksum", `${asset.sha256.slice(0, 16)}…`],
  ];

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
        <h1 className="text-sm font-bold">
          {asset.name || asset.description?.slice(0, 60) || "Untitled media"}
        </h1>
        <Badge
          variant={asset.rating === "SFW" ? "secondary" : "destructive"}
          className="h-5 px-1.5 text-[10px]"
        >
          {asset.rating}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {asset.variants.length} variant{asset.variants.length > 1 ? "s" : ""} ·{" "}
          {asset.usages.length} use{asset.usages.length > 1 ? "s" : ""}
        </span>
      </div>

      <TabsShell
        tabs={[
          {
            value: "overview",
            label: "Overview",
            fill: true,
            content: (
              <AssetOriginal assetId={asset.id} rating={asset.rating} isVideo={isVideo} />
            ),
          },
          {
            value: "variants",
            label: "Variants",
            content: (
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
            ),
          },
          {
            value: "usage",
            label: "Usage",
            content: (
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
            ),
          },
        ]}
        sidebar={
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Properties</CardTitle>
              </CardHeader>
              <CardContent>
                <PropertiesForm
                  assetId={asset.id}
                  name={asset.name ?? ""}
                  description={asset.description ?? ""}
                  rating={asset.rating}
                  usageCount={asset.usages.length}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Metadata</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-1.5 text-xs">
                  {metadata.map(([label, value]) => (
                    <div key={label} className="flex gap-3">
                      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
                      <dd className="min-w-0 flex-1 break-words font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </>
        }
      />
    </FixedHeightPage>
  );
}
