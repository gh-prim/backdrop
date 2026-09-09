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
        title="Settings"
        description="Members, personas and channels for this organization."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Members</CardTitle>
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
                There is no public sign-up route. Accounts only come from an
                invitation, whose link you pass along yourself.
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
              Only an owner can invite or remove members.
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
                      <span className="text-xs text-muted-foreground">no channel</span>
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
              <li className="py-2 text-xs text-muted-foreground">No personas yet.</li>
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
          <CardTitle className="text-sm">Channels</CardTitle>
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
                  {channel.state === "connected" && `connected · expires in ${channel.expiresInDays} d`}
                  {channel.state === "expiring" && `reconnect within ${channel.expiresInDays} d`}
                  {channel.state === "expired" && "expired"}
                  {channel.state === "unknown" && "unknown state"}
                </span>
              </li>
            ))}
            {channels.length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">No channel connected.</li>
            )}
          </ul>

          {isOwner ? (
            <div className="border-t pt-4">
              <InstagramForm personas={personas} />
              <p className="mt-3 text-xs text-muted-foreground">
                Telegram lands in phase 2, Fanvue in phase 4.
              </p>
            </div>
          ) : (
            <p className="border-t pt-4 text-xs text-muted-foreground">
              Only an owner can configure a ChannelAccount. Credentials are never
              shown, whatever the role.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
