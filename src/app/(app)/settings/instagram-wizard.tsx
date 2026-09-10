"use client";

import { useActionState, useEffect, useState } from "react";
import { connectInstagramAccountAction, type ActionResult } from "@/app/actions/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WizardSteps } from "@/components/wizard-steps";
import type { PersonaOption } from "@/lib/persona";

const STEPS = ["Persona", "Account", "Token"] as const;

/**
 * Connexion d'un compte Instagram (4.1).
 *
 * En trois temps, parce que les trois informations viennent d'endroits
 * différents: la persona est interne, l'`ig_user_id` vient du compte, et le
 * token du Graph API Explorer. Les regrouper sur un seul écran donnait un mur
 * de champs sans rapport entre eux.
 *
 * Le token soumis peut être de courte durée: il est échangé contre un
 * long-lived à la connexion, puis chiffré. Il n'est jamais réaffiché.
 */
export function InstagramWizard({
  personas,
  onDone,
}: {
  personas: PersonaOption[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    connectInstagramAccountAction,
    null,
  );
  const [step, setStep] = useState(0);
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? "");
  const [igUserId, setIgUserId] = useState("");

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (personas.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Create a persona first: a channel is always attached to one.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <WizardSteps
        steps={STEPS}
        current={step}
        maxReached={step}
        onJump={(index) => setStep(Math.min(index, step))}
      />

      {/* Les champs des étapes précédentes restent dans le formulaire: c'est
          une seule soumission, en une seule action, à la fin. */}
      <input type="hidden" name="personaId" value={personaId} />
      {step > 1 && <input type="hidden" name="igUserId" value={igUserId} />}

      {step === 0 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ig-persona">Which persona is this account for?</Label>
            <select
              id="ig-persona"
              value={personaId}
              onChange={(event) => setPersonaId(event.target.value)}
              className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
            >
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name} · @{persona.handle}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" className="h-8" onClick={() => setStep(1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="igUserId">ig_user_id</Label>
            <Input
              id="igUserId"
              value={igUserId}
              onChange={(event) => setIgUserId(event.target.value)}
              className="h-8 w-full"
              placeholder="17841400000000000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pageId">Facebook Page (optional)</Label>
            <Input id="pageId" name="pageId" className="h-8 w-full" />
          </div>
          <p className="text-xs text-muted-foreground">
            The professional account id, not the handle. Instagram is capped at SFW here: that
            is a property of the channel, not a setting.
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={igUserId.trim().length === 0}
              onClick={() => setStep(2)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="accessToken">Access token</Label>
            <Input
              id="accessToken"
              name="accessToken"
              type="password"
              required
              autoComplete="off"
              className="h-8 w-full"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A short-lived token from the Graph API Explorer is fine: it is exchanged for a
            60-day one on connect, then encrypted. It is never shown again, not even to an owner.
          </p>

          {state?.ok === false && <p className="text-xs text-destructive">{state.error}</p>}

          <div className="flex justify-end">
            <Button type="submit" size="sm" className="h-8" disabled={pending}>
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
