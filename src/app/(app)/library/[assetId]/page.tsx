import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/session";
import { getAssetDetail } from "@/lib/assets";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetOriginal } from "./asset-original";
import { PropertiesForm } from "./properties-form";
import { VariantList } from "./variant-list";
import { UsageList } from "./usage-list";

function humanSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Fiche d'un média.
 *
 * Aucun défilement de page (spec 6.1): le contenu est réparti en onglets, les
 * propriétés qui doivent rester visibles vivent dans la sidebar droite, et
 * seuls les panneaux internes défilent s'ils débordent.
 */
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
    ["Durée", asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)} s` : "—"],
    ["Type", asset.mimeType ?? "—"],
    [
      "Ajouté le",
      asset.createdAt.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }),
    ],
    ["Par", asset.createdBy.name],
    ["Empreinte", `${asset.sha256.slice(0, 16)}…`],
  ];

  return (
    // Hauteur contrainte: la fiche tient dans la fenêtre, elle ne défile pas.
    <div className="flex h-[calc(100svh-7.5rem)] flex-col gap-4 overflow-hidden">
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
          {asset.name || asset.description?.slice(0, 60) || "Média sans nom"}
        </h1>
        <Badge
          variant={asset.rating === "SFW" ? "secondary" : "destructive"}
          className="h-5 px-1.5 text-[10px]"
        >
          {asset.rating}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {asset.variants.length} variant{asset.variants.length > 1 ? "s" : ""} ·{" "}
          {asset.usages.length} utilisation{asset.usages.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <Tabs defaultValue="general" className="flex min-h-0 flex-col gap-3">
          {/* Onglets pleine largeur en style souligné: ils tiennent lieu de
              navigation de la fiche, pas de petit sélecteur secondaire. */}
          <TabsList variant="line" className="w-full border-b">
            <TabsTrigger value="general">Général</TabsTrigger>
            <TabsTrigger value="variants">Variantes</TabsTrigger>
            <TabsTrigger value="usages">Utilisations</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="min-h-0 overflow-hidden">
            <AssetOriginal assetId={asset.id} rating={asset.rating} isVideo={isVideo} />
          </TabsContent>

          <TabsContent value="variants" className="min-h-0 overflow-y-auto pr-1">
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
          </TabsContent>

          <TabsContent value="usages" className="min-h-0 overflow-y-auto pr-1">
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
          </TabsContent>
        </Tabs>

        {/* Sidebar persistante: ce qui doit rester lisible quel que soit
            l'onglet actif. Elle défile en interne, pas la page. */}
        <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Propriétés</CardTitle>
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
              <CardTitle className="text-sm">Métadonnées</CardTitle>
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


        </aside>
      </div>
    </div>
  );
}
