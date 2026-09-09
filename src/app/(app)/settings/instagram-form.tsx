"use client";

import { useActionState } from "react";
import { connectInstagramAccountAction, type ActionResult } from "@/app/actions/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PersonaOption } from "@/lib/persona";

export function InstagramForm({ personas }: { personas: PersonaOption[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    connectInstagramAccountAction,
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ig-persona">Persona</Label>
          <select
            id="ig-persona"
            name="personaId"
            className="h-8 rounded-md border bg-transparent px-2 text-sm"
          >
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="igUserId">ig_user_id</Label>
          <Input id="igUserId" name="igUserId" required className="h-8 w-52" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pageId">Facebook Page (optional)</Label>
          <Input id="pageId" name="pageId" className="h-8 w-52" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="accessToken">Long-lived access token</Label>
        <Input
          id="accessToken"
          name="accessToken"
          type="password"
          required
          autoComplete="off"
          className="h-8 w-full max-w-2xl"
        />
        <p className="text-xs text-muted-foreground">
          Paste the token from the Graph API Explorer, even a short-lived one: it is
          exchanged for a 60-day long-lived token on connect, then encrypted at rest.
          It is never shown again, here or anywhere, not even to an owner.
        </p>
      </div>

      <Button type="submit" size="sm" disabled={pending || personas.length === 0}>
        {pending ? "Connecting…" : "Connect Instagram"}
      </Button>

      {state && !state.ok && <p className="text-xs text-destructive">{state.error}</p>}
      {state?.ok && (
        <p className="text-xs text-muted-foreground">
          Channel connected and verified: the token answers for this ig_user_id.
        </p>
      )}
    </form>
  );
}
