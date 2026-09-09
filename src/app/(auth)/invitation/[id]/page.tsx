import { getUsableInvitation } from "@/lib/invitations";
import { AcceptForm } from "./accept-form";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invitation = await getUsableInvitation(id);

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-black tracking-tight">Backdrop</h1>
          {invitation ? (
            <p className="text-sm text-muted-foreground">
              Invitation à rejoindre {invitation.organizationName} en tant que{" "}
              <span className="text-foreground">{invitation.role}</span>.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Cette invitation est invalide, déjà utilisée ou expirée. Demandez-en une
              nouvelle à un owner.
            </p>
          )}
        </div>

        {invitation && <AcceptForm invitationId={invitation.id} email={invitation.email} />}
      </div>
    </div>
  );
}
