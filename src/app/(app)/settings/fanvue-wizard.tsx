"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { saveFanvueAppAction, type FanvueResult } from "@/app/actions/fanvue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PersonaOption } from "@/lib/persona";

/**
 * Connexion Fanvue, en deux temps.
 *
 * 1. L'application OAuth de l'organisation, saisie une fois — Fanvue n'a pas
 *    de clé d'API statique, tout passe par un flux d'autorisation (4.3.2).
 * 2. L'autorisation de la persona, qui se déroule **chez Fanvue**: on quitte
 *    l'application et on revient avec les jetons.
 *
 * Le second temps ne peut pas être simulé dans un formulaire: c'est la
 * différence avec Instagram, où un token se colle.
 */
export function FanvueWizard({
  personas,
  appConfigured,
  initialPersonaId,
  onDone,
}: {
  personas: PersonaOption[];
  appConfigured: boolean;
  /** Persona à reconnecter: le parcours est le même, la cible est connue. */
  initialPersonaId?: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"app" | "authorize">(
    appConfigured ? "authorize" : "app",
  );
  const [personaId, setPersonaId] = useState(
    initialPersonaId ?? personas[0]?.id ?? "",
  );

  const [state, action, pending] = useActionState<FanvueResult | null, FormData>(
    saveFanvueAppAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Saved.");
      setStep("authorize");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (step === "app") {
    return (
      <form action={action} className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Create an app in the Fanvue Builder (type <em>off-platform</em>), then
          paste its credentials here. They are stored encrypted and never shown
          again.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="fv-client-id">Client ID</Label>
          <Input id="fv-client-id" name="clientId" required className="h-8" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fv-client-secret">Client secret</Label>
          <Input
            id="fv-client-secret"
            name="clientSecret"
            type="password"
            required
            className="h-8"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fv-redirect">Redirect URI</Label>
          <Input
            id="fv-redirect"
            name="redirectUri"
            defaultValue={
              typeof window === "undefined"
                ? ""
                : `${window.location.origin}/api/fanvue/callback`
            }
            required
            className="h-8"
          />
          <p className="text-xs text-muted-foreground">
            {/* La cause d'échec la plus fréquente du flux, et la plus opaque:
                Fanvue compare la chaîne au caractère près. */}
            Must match the one declared in the Fanvue app, character for
            character.
          </p>
        </div>

        {state?.ok === false && (
          <p className="text-xs text-destructive">{state.error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" className="h-8" disabled={pending}>
            {pending ? "Saving…" : "Save app"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Authorization happens on Fanvue: you sign in there as the creator and
        grant the app. You come back with the tokens already stored.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="fv-persona">Persona</Label>
        <select
          id="fv-persona"
          value={personaId}
          onChange={(event) => setPersonaId(event.target.value)}
          className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
        >
          {personas.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {persona.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setStep("app")}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Replace the app credentials
        </button>

        <Button
          size="sm"
          className="h-8"
          nativeButton={false}
          render={<a href={`/api/fanvue/authorize?personaId=${personaId}`} />}
        >
          <ExternalLink className="size-3.5" />
          Authorize on Fanvue
        </Button>
      </div>
    </div>
  );
}
