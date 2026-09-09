"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/session";
import { ALL_PERSONAS, PERSONA_COOKIE } from "@/lib/persona";
import { listPersonas } from "@/lib/persona-scope";

/** Change la persona active. Le geste le plus fréquent du produit (6.1). */
export async function selectPersona(personaId: string) {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);

  const value =
    personaId === ALL_PERSONAS || personas.some((p) => p.id === personaId)
      ? personaId
      : ALL_PERSONAS;

  const cookieStore = await cookies();
  cookieStore.set(PERSONA_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
