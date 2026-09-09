"use client";

import { useActionState } from "react";
import { createPersonaAction, type ActionResult } from "@/app/actions/personas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PersonaForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createPersonaAction,
    null,
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Input name="name" required placeholder="Nom" className="h-8 w-44" />
      <Input name="handle" required placeholder="handle" className="h-8 w-44" />
      <Input
        name="timezone"
        defaultValue="Europe/Paris"
        placeholder="Fuseau"
        className="h-8 w-40"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Création…" : "Créer une persona"}
      </Button>
      {state && !state.ok && (
        <p className="w-full text-xs text-destructive">{state.error}</p>
      )}
    </form>
  );
}
