"use client";

import { useActionState } from "react";
import { uploadAssetAction, type ActionResult } from "@/app/actions/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PersonaOption } from "@/lib/persona";
import { ALL_PERSONAS } from "@/lib/persona";

const RATIOS = ["4:5", "9:16", "1:1"];

export function UploadForm({
  personas,
  defaultPersonaId,
}: {
  personas: PersonaOption[];
  defaultPersonaId: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    uploadAssetAction,
    null,
  );

  const preselected =
    defaultPersonaId === ALL_PERSONAS ? personas[0]?.id : defaultPersonaId;

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="file">Fichier</Label>
        <Input
          id="file"
          name="file"
          type="file"
          required
          accept=".jpg,.jpeg,.png,.mp4,.mov"
          className="h-8 w-64"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="personaId">Persona</Label>
        <select
          id="personaId"
          name="personaId"
          defaultValue={preselected}
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
        <Label htmlFor="rating">Rating</Label>
        {/* Immuable après création (9.4): on ne le corrige pas, on recrée. */}
        <select
          id="rating"
          name="rating"
          defaultValue="SFW"
          className="h-8 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="SFW">SFW</option>
          <option value="SUGGESTIVE">SUGGESTIVE</option>
          <option value="NSFW">NSFW</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>Ratios à dériver</Label>
        <div className="flex h-8 items-center gap-3">
          {RATIOS.map((ratio) => (
            <label key={ratio} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                name="ratios"
                value={ratio}
                defaultChecked={ratio !== "1:1"}
              />
              {ratio}
            </label>
          ))}
        </div>
      </div>

      <Button type="submit" size="sm" disabled={pending || personas.length === 0}>
        {pending ? "Envoi…" : "Uploader"}
      </Button>

      {state && !state.ok && (
        <p className="w-full text-xs text-destructive">{state.error}</p>
      )}
      {state?.ok && <p className="w-full text-xs text-muted-foreground">{state.message}</p>}
    </form>
  );
}
