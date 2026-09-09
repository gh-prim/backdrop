import Link from "next/link";
import { requireOrgContext } from "@/lib/session";
import { getSelectedPersonaId, listPersonas } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listChannelStatus } from "@/lib/channels";
import { listPublications } from "@/lib/publications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatDate(date: Date) {
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default async function DashboardPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const scoped =
    selectedId === ALL_PERSONAS ? personas : personas.filter((p) => p.id === selectedId);

  // Projection sûre: aucun credential ne descend jusqu'au client (9.7).
  const channels = await listChannelStatus(ctx);
  const publications = await listPublications(
    ctx,
    selectedId === ALL_PERSONAS ? undefined : selectedId,
  );

  const upcoming = publications
    .filter((p) => p.status === "SCHEDULED" || p.status === "PUBLISHING")
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .slice(0, 8);

  // Deux files distinctes: un échec est un incident, une publication manquée
  // est une décision en attente (7.6).
  const failed = publications.filter((p) => p.status === "FAILED");
  const missed = publications.filter((p) => p.status === "MISSED");

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold">
          {selectedId === ALL_PERSONAS ? "Toutes les personas" : scoped[0]?.name}
        </h1>
        <Link href="/composer" className="text-xs text-muted-foreground hover:text-foreground">
          Nouvelle publication →
        </Link>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Publications à venir</CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-xs text-muted-foreground">Rien de programmé.</p>
            ) : (
              <ul className="divide-y text-sm">
                {upcoming.map((publication) => (
                  <li key={publication.id} className="flex items-center gap-2 py-1.5">
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(publication.scheduledAt)}
                    </span>
                    <span className="font-medium">
                      {publication.channelAccount.persona.name}
                    </span>
                    <Badge variant="outline" className="h-4 px-1 text-[9px]">
                      {publication.channelAccount.platform}
                    </Badge>
                    <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                      {publication.kind}
                    </Badge>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {publication.createdBy.name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">À traiter</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Link href="/publications" className="block hover:underline">
              <span className="text-2xl font-black">{failed.length}</span>{" "}
              <span className="text-xs text-muted-foreground">échec(s)</span>
            </Link>
            <Link href="/publications" className="block hover:underline">
              <span className="text-2xl font-black">{missed.length}</span>{" "}
              <span className="text-xs text-muted-foreground">manquée(s) à trancher</span>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scoped.map((persona) => {
          const personaChannels = channels.filter((c) => c.personaId === persona.id);
          const personaPublications = publications.filter(
            (p) => p.channelAccount.persona.id === persona.id,
          );
          return (
            <Card key={persona.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-baseline gap-2 text-sm">
                  {persona.name}
                  <span className="text-xs font-normal text-muted-foreground">
                    @{persona.handle}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {personaChannels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucun canal connecté.</p>
                ) : (
                  <ul className="space-y-1">
                    {personaChannels.map((channel) => (
                      <li key={channel.id} className="flex items-center gap-2 text-xs">
                        <span className="font-medium">{channel.platform}</span>
                        {/* Le rating est affiché partout, sans exception (6.1). */}
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          max {channel.maxRating}
                        </Badge>
                        <span className="ml-auto text-muted-foreground">
                          {channel.state}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  {personaPublications.filter((p) => p.status === "PUBLISHED").length} publiée(s)
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
