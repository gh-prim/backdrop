"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/session";
import {
  configSchema,
  exportConfig,
  importConfig,
  OperatorError,
  type ImportPlan,
} from "@/lib/config-backup";

export type ExportResult =
  | { ok: true; filename: string; json: string; withSecrets: boolean }
  | { ok: false; error: string };

export type ImportResult =
  | { ok: true; plan: ImportPlan; applied: boolean }
  | { ok: false; error: string };

/** Une phrase courte protégerait mal un fichier qui peut traîner longtemps. */
const MIN_PASSPHRASE = 12;

export async function exportConfigAction(
  passphrase: string | null,
): Promise<ExportResult> {
  const ctx = await requireOrgContext();
  // Réservé au propriétaire: le fichier décrit toute l'installation, et peut
  // porter ses identifiants.
  if (ctx.role !== "owner") return { ok: false, error: "Owners only." };

  if (passphrase !== null && passphrase.length < MIN_PASSPHRASE) {
    return {
      ok: false,
      error: `The passphrase protects the credentials in this file: ${MIN_PASSPHRASE} characters minimum.`,
    };
  }

  const backup = await exportConfig(ctx, {
    passphrase: passphrase ?? undefined,
  });

  const stamp = backup.exportedAt.slice(0, 10);
  return {
    ok: true,
    filename: `backdrop-config-${backup.organization.slug}-${stamp}.json`,
    json: JSON.stringify(backup, null, 2),
    withSecrets: backup.secrets !== null,
  };
}

export async function importConfigAction(
  fileText: string,
  passphrase: string | null,
  dryRun: boolean,
): Promise<ImportResult> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") return { ok: false, error: "Owners only." };

  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Not a Backdrop configuration file: ${parsed.error.issues[0]?.message ?? "unexpected shape"}.`,
    };
  }

  try {
    const plan = await importConfig(ctx, parsed.data, {
      passphrase: passphrase ?? undefined,
      dryRun,
    });
    if (!dryRun) {
      revalidatePath("/settings");
      revalidatePath("/library");
    }
    return { ok: true, plan, applied: !dryRun };
  } catch (error) {
    // Seuls les messages écrits pour l'opérateur remontent. Une erreur Prisma
    // afficherait sinon l'URL de la base au navigateur (9.7).
    if (error instanceof OperatorError) return { ok: false, error: error.message };
    console.error("importConfig", error);
    return { ok: false, error: "Import failed. See the server logs." };
  }
}
