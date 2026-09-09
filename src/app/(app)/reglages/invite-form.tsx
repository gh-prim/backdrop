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
        placeholder="email@equipe.local"
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
        {pending ? "Invitation…" : "Inviter"}
      </Button>
      {state && !state.ok && (
        <p className="w-full text-xs text-destructive">{state.error}</p>
      )}
      {state?.ok && (
        <p className="w-full text-xs text-muted-foreground">
          Invitation créée. Copiez le lien ci-dessous et transmettez-le.
        </p>
      )}
    </form>
  );
}
