"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { encryptCredentials } from "@/lib/crypto";
import {
  cancelTelegramLogin,
  readTelegramLoginState,
  sendTelegramLoginCode,
  sendTelegramLoginPassword,
  startTelegramLogin,
} from "@/temporal/client";
import type { TelegramLoginState } from "@/temporal/config";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type LoginStarted =
  | { ok: true; loginId: string }
  | { ok: false; error: string };

const appSchema = z.object({
  personaId: z.string().min(1),
  // Telegram délivre un api_id numérique; une saisie non numérique est une
  // erreur de copier-coller, pas une valeur exotique à accepter.
  apiId: z.coerce.number().int().positive("api_id must be a positive number."),
  apiHash: z
    .string()
    .regex(/^[0-9a-f]{32}$/i, "api_hash is a 32-character hexadecimal string."),
});

/**
 * Enregistre le couple api_id / api_hash d'une persona (4.2.1).
 *
 * Un couple par persona: un api_id se crée sur my.telegram.org depuis le compte
 * lui-même. Chiffré au repos comme n'importe quel credential plateforme, il ne
 * repart jamais vers le client (9.7) — l'écran n'affiche que sa présence.
 */
export async function saveTelegramAppAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireOwner();
  const parsed = appSchema.safeParse({
    personaId: formData.get("personaId"),
    apiId: String(formData.get("apiId") ?? "").trim(),
    apiHash: String(formData.get("apiHash") ?? "").trim(),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // La persona doit appartenir à l'organisation: sans cette vérification,
  // l'identifiant reçu du formulaire suffirait à écrire chez un autre tenant.
  const persona = await prisma.persona.findFirst({
    where: { id: parsed.data.personaId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!persona) return { ok: false, error: "Persona not found." };

  const credentials = encryptCredentials({
    apiId: parsed.data.apiId,
    apiHash: parsed.data.apiHash,
  });

  await prisma.telegramApp.upsert({
    where: { personaId: persona.id },
    create: { personaId: persona.id, credentials },
    update: { credentials },
  });

  revalidatePath("/settings");
  return { ok: true };
}

const startSchema = z.object({
  personaId: z.string().min(1),
  // Telegram exige le format international. Le refuser ici évite un aller-retour
  // et un envoi de code consommé pour rien.
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, "International format required, e.g. +33612345678."),
});

/** Démarre la connexion: Telegram envoie le code, le workflow attend. */
export async function startTelegramLoginAction(
  _prev: LoginStarted | null,
  formData: FormData,
): Promise<LoginStarted> {
  const ctx = await requireOwner();
  const parsed = startSchema.safeParse({
    personaId: formData.get("personaId"),
    phone: String(formData.get("phone") ?? "").replace(/[\s.-]/g, ""),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const persona = await prisma.persona.findFirst({
    where: { id: parsed.data.personaId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!persona) return { ok: false, error: "Persona not found." };

  const app = await prisma.telegramApp.findUnique({
    where: { personaId: persona.id },
    select: { id: true },
  });
  if (!app) {
    return {
      ok: false,
      error:
        "Save this persona's api_id and api_hash first: Telegram cannot be reached without them.",
    };
  }

  const loginId = randomUUID();
  try {
    await startTelegramLogin({ loginId, personaId: persona.id, phone: parsed.data.phone });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  return { ok: true, loginId };
}

const codeSchema = z.object({
  loginId: z.string().min(1),
  // Telegram envoie 5 chiffres, parfois espacés par l'application mobile.
  code: z.string().regex(/^\d{5,6}$/, "The code is 5 or 6 digits."),
});

export async function submitTelegramCodeAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireOwner();
  const parsed = codeSchema.safeParse({
    loginId: formData.get("loginId"),
    code: String(formData.get("code") ?? "").replace(/\s/g, ""),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await sendTelegramLoginCode(parsed.data.loginId, parsed.data.code);
  } catch {
    return { ok: false, error: "Login expired. Start again." };
  }
  return { ok: true };
}

export async function submitTelegramPasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireOwner();
  const loginId = String(formData.get("loginId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!loginId || !password) return { ok: false, error: "Password required." };

  try {
    await sendTelegramLoginPassword(loginId, password);
  } catch {
    return { ok: false, error: "Login expired. Start again." };
  }
  return { ok: true };
}

/**
 * État du login, interrogé par l'écran pendant l'attente.
 *
 * Le workflow ne publie ni code, ni mot de passe, ni session: une requête
 * Temporal est lisible par quiconque atteint le namespace.
 */
export async function readTelegramLoginStateAction(
  loginId: string,
): Promise<TelegramLoginState | null> {
  await requireOwner();
  const state = await readTelegramLoginState(loginId);
  if (state?.state === "connected") revalidatePath("/settings");
  return state;
}

export async function cancelTelegramLoginAction(loginId: string): Promise<void> {
  await requireOwner();
  await cancelTelegramLogin(loginId);
}
