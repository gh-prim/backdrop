"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/session";

const personaSchema = z.object({
  name: z.string().min(1, "Name required.").max(80),
  handle: z
    .string()
    .min(1, "Handle required.")
    .max(80)
    .regex(/^[a-z0-9._]+$/, "Lowercase letters, digits, dot and underscore only."),
  timezone: z.string().min(1),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Créer une persona est réservé au rôle owner (7.4). */
export async function createPersonaAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOwner();
  const parsed = personaSchema.safeParse({
    name: formData.get("name"),
    handle: String(formData.get("handle") ?? "").trim().toLowerCase(),
    timezone: formData.get("timezone") || "Europe/Paris",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const duplicate = await prisma.persona.findFirst({
    where: { organizationId: ctx.organizationId, handle: parsed.data.handle },
    select: { id: true },
  });
  if (duplicate) {
    return { ok: false, error: "This handle already exists in the organization." };
  }

  await prisma.persona.create({
    data: { ...parsed.data, organizationId: ctx.organizationId, bible: {} },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
