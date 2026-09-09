import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { ALL_PERSONAS, PERSONA_COOKIE, type PersonaOption } from "@/lib/persona";
import type { OrgContext } from "@/lib/session";

/**
 * Personas visibles par la session. La persona est une unité de *scope*, pas
 * d'isolation (spec 3 et 7.4): un `member` voit tout le portefeuille de son
 * organisation. La frontière de sécurité reste l'organizationId.
 */
export async function listPersonas(ctx: OrgContext): Promise<PersonaOption[]> {
  return prisma.persona.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, name: true, handle: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Persona sélectionnée dans le header. Le cookie n'est jamais cru sur parole:
 * une valeur qui ne correspond à aucune persona de l'organisation retombe sur
 * la vue globale.
 */
export async function getSelectedPersonaId(
  personas: PersonaOption[],
): Promise<string> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PERSONA_COOKIE)?.value;
  if (!raw || raw === ALL_PERSONAS) return ALL_PERSONAS;
  return personas.some((p) => p.id === raw) ? raw : ALL_PERSONAS;
}
