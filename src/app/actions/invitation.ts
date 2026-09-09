"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptInvitation } from "@/lib/invitations";

const schema = z.object({
  invitationId: z.string().min(1),
  name: z.string().min(1, "Name required.").max(80),
  password: z.string().min(12, "12 characters minimum."),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Accepte une invitation et crée le compte. Action publique par nécessité,
 * mais elle n'est utilisable qu'avec un identifiant d'invitation valide et
 * non expiré: ce n'est pas une route d'inscription ouverte (9.8).
 */
export async function acceptInvitationAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = schema.safeParse({
    invitationId: formData.get("invitationId"),
    name: formData.get("name"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await acceptInvitation(parsed.data.invitationId, {
      name: parsed.data.name,
      password: parsed.data.password,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed." };
  }

  redirect("/login");
}
