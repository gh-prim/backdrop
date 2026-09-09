import { requireOrgContext } from "@/lib/session";
import { listMembers, listPendingInvitations } from "@/lib/invitations";
import { listPersonas } from "@/lib/persona-scope";
import { listChannelStatus } from "@/lib/channels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteForm } from "./invite-form";
import { PersonaForm } from "./persona-form";
import { InvitationRow } from "./invitation-row";
import { InstagramForm } from "./instagram-form";
import { PageHeader } from "@/components/page-header";

export default async function SettingsPage() {
  const ctx = await requireOrgContext();
  const isOwner = ctx.role === "owner";

  const [members, invitations, personas, channels] = await Promise.all([
    listMembers(ctx),
    isOwner ? listPendingInvitations(ctx) : Promise.resolve([]),
    listPersonas(ctx),
    listChannelStatus(ctx),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Réglages"
        description="Membres, personas et canaux de l'organisation."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Membres</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y text-sm">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-2">
                <span className="font-medium">{member.user.name}</span>
                <span className="text-muted-foreground">{member.user.email}</span>
                <Badge
                  variant={member.role === "owner" ? "default" : "secondary"}
                  className="ml-auto h-5 px-1.5 text-[10px] uppercase"
                >
                  {member.role}
                </Badge>
              </li>
            ))}
          </ul>

          {isOwner ? (
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                Il n&apos;y a pas de route publique d&apos;inscription. Un compte ne naît que
                d&apos;une invitation, dont le lien se transmet à la main.
              </p>
              <InviteForm />
              {invitations.length > 0 && (
                <ul className="space-y-2">
                  {invitations.map((invitation) => (
                    <InvitationRow key={invitation.id} invitation={invitation} />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="border-t pt-4 text-xs text-muted-foreground">
              Seul un owner peut inviter ou retirer des membres.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Personas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y text-sm">
            {personas.map((persona) => {
              const personaChannels = channels.filter((c) => c.personaId === persona.id);
              return (
                <li key={persona.id} className="flex items-center gap-2 py-2">
                  <span className="font-medium">{persona.name}</span>
                  <span className="text-muted-foreground">@{persona.handle}</span>
                  <span className="ml-auto flex gap-1">
                    {personaChannels.length === 0 ? (
                      <span className="text-xs text-muted-foreground">aucun canal</span>
                    ) : (
                      personaChannels.map((channel) => (
                        <Badge
                          key={channel.id}
                          variant="outline"
                          className="h-5 px-1.5 text-[10px]"
                        >
                          {channel.platform} · {channel.state}
                        </Badge>
                      ))
                    )}
                  </span>
                </li>
              );
            })}
            {personas.length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">Aucune persona.</li>
            )}
          </ul>

          {isOwner && (
            <div className="border-t pt-4">
              <PersonaForm />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Canaux</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y text-sm">
            {channels.map((channel) => (
              <li key={channel.id} className="flex items-center gap-2 py-2">
                <span className="font-medium">{channel.platform}</span>
                <span className="text-muted-foreground">
                  {personas.find((p) => p.id === channel.personaId)?.name}
                </span>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  max {channel.maxRating}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {channel.state === "connected" && `connecté · expire dans ${channel.expiresInDays} j`}
                  {channel.state === "expiring" && `à reconnecter sous ${channel.expiresInDays} j`}
                  {channel.state === "expired" && "expiré"}
                  {channel.state === "unknown" && "état inconnu"}
                </span>
              </li>
            ))}
            {channels.length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">Aucun canal connecté.</li>
            )}
          </ul>

          {isOwner ? (
            <div className="border-t pt-4">
              <InstagramForm personas={personas} />
              <p className="mt-3 text-xs text-muted-foreground">
                Telegram arrive en phase 2, Fanvue en phase 4.
              </p>
            </div>
          ) : (
            <p className="border-t pt-4 text-xs text-muted-foreground">
              Seul un owner peut configurer un ChannelAccount. Les credentials ne sont
              jamais affichés, quel que soit le rôle.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
