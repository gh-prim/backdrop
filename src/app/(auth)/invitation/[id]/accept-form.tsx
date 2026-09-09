"use client";

import { useActionState } from "react";
import { acceptInvitationAction, type ActionResult } from "@/app/actions/invitation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AcceptForm({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    acceptInvitationAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="invitationId" value={invitationId} />

      <div className="space-y-1.5">
        <Label>Email</Label>
        {/* L'email vient de l'invitation, il n'est pas modifiable. */}
        <Input value={email} disabled readOnly />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required autoComplete="name" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">12 characters minimum.</p>
      </div>

      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create my account"}
      </Button>
    </form>
  );
}
