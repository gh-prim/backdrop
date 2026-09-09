"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/session";
import { cancelInvitation, createInvitation } from "@/lib/invitations";
import { ORG_ROLES } from "@/lib/auth";

const inviteSchema = z.object({
  email: z.email("Invalid email address."),
  role: z.enum(ORG_ROLES),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function inviteMemberAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOwner();
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await createInvitation(ctx, parsed.data.email, parsed.data.role);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed." };
  }

  revalidatePath("/settings");
  return { ok: true };
}

export async function cancelInvitationAction(invitationId: string) {
  const ctx = await requireOwner();
  await cancelInvitation(ctx, invitationId);
  revalidatePath("/settings");
}
