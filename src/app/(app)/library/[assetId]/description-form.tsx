"use client";

import { useActionState } from "react";
import {
  updateAssetDescriptionAction,
  type ActionResult,
} from "@/app/actions/asset-detail";
import { Button } from "@/components/ui/button";

export function DescriptionForm({
  assetId,
  description,
}: {
  assetId: string;
  description: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateAssetDescriptionAction,
    null,
  );

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="assetId" value={assetId} />
      <textarea
        name="description"
        rows={4}
        defaultValue={description}
        maxLength={2000}
        placeholder="Note interne: contexte, tenue, série, ce qu'il ne faut pas en faire…"
        className="w-full rounded-md border bg-transparent p-2 text-sm"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {state && !state.ok && (
          <span className="text-xs text-destructive">{state.error}</span>
        )}
        {state?.ok && (
          <span className="text-xs text-muted-foreground">{state.message}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Interne à l&apos;outil: elle n&apos;est jamais envoyée sur une plateforme.
      </p>
    </form>
  );
}
