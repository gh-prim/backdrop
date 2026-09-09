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
          <Label htmlFor="pageId">Page Facebook (optionnel)</Label>
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
          Colle le token du Graph API Explorer, même de courte durée: il est échangé
          contre un long-lived de 60 jours à la connexion, puis chiffré au repos. Il
          n&apos;est jamais réaffiché, ni ici, ni ailleurs, ni pour un owner.
        </p>
      </div>

      <Button type="submit" size="sm" disabled={pending || personas.length === 0}>
        {pending ? "Connexion…" : "Connecter Instagram"}
      </Button>

      {state && !state.ok && <p className="text-xs text-destructive">{state.error}</p>}
      {state?.ok && (
        <p className="text-xs text-muted-foreground">
          Canal connecté et vérifié: le token répond pour cet ig_user_id.
        </p>
      )}
    </form>
  );
}
