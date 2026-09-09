import { requireOrgContext } from "@/lib/session";
import { getSelectedPersonaId, listPersonas } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listChannelStatus } from "@/lib/channels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function DashboardPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const scoped = selectedId === ALL_PERSONAS ? personas : personas.filter((p) => p.id === selectedId);

  // Projection sûre: aucun credential ne descend jusqu'au client (9.7).
  const channels = await listChannelStatus(ctx);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold">
          {selectedId === ALL_PERSONAS ? "Toutes les personas" : scoped[0]?.name}
        </h1>
        <p className="text-xs text-muted-foreground">
          Phase 0 — fondations. Publications et statistiques arrivent en phase 1.
        </p>
      </div>

      {scoped.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aucune persona. Un <span className="font-medium text-foreground">owner</span> peut en
            créer une depuis les Réglages.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {scoped.map((persona) => {
            const personaChannels = channels.filter((c) => c.personaId === persona.id);
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
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
