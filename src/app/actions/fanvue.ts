"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/session";
import { saveFanvueApp } from "@/lib/channels/fanvue-app";

export type FanvueResult = { ok: true; message?: string } | { ok: false; error: string };

const schema = z.object({
  clientId: z.string().trim().min(10, "The client id looks too short."),
  clientSecret: z.string().trim().min(20, "The client secret looks too short."),
  // Doit correspondre au caractère près à celui déclaré chez Fanvue: une
  // barre oblique de trop et l'autorisation est refusée sans autre explication.
  redirectUri: z.string().trim().url("The redirect URI must be a full URL."),
});

/**
 * Enregistre l'application OAuth Fanvue de l'organisation (4.3.2).
 *
 * Rien n'est renvoyé de ce qui a été saisi: la valeur repart chiffrée en base
 * et ne réapparaît jamais à l'écran, pas même tronquée (9.7).
 */
export async function saveFanvueAppAction(
  _prev: FanvueResult | null,
  formData: FormData,
): Promise<FanvueResult> {
  const ctx = await requireOwner();

  const parsed = schema.safeParse({
    clientId: formData.get("clientId"),
    clientSecret: formData.get("clientSecret"),
    redirectUri: formData.get("redirectUri"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await saveFanvueApp(ctx, parsed.data);
  revalidatePath("/settings");
  return { ok: true, message: "Fanvue app saved. You can authorize a persona now." };
}
