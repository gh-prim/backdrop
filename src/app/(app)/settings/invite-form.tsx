"use client";

import { useActionState } from "react";
import { inviteMemberAction, type ActionResult } from "@/app/actions/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    inviteMemberAction,
    null,
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Input
        name="email"
        type="email"
        required
        placeholder="email@team.local"
        className="h-8 w-64"
      />
      <select
        name="role"
        defaultValue="member"
        className="h-8 rounded-md border bg-transparent px-2 text-sm"
      >
        <option value="member">member</option>
        <option value="owner">owner</option>
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Inviting…" : "Invite"}
      </Button>
      {state && !state.ok && (
        <p className="w-full text-xs text-destructive">{state.error}</p>
      )}
      {state?.ok && (
        <p className="w-full text-xs text-muted-foreground">
          Invitation created. Copy the link below and pass it along.
        </p>
      )}
    </form>
  );
}
