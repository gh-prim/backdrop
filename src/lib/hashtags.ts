import "server-only";
import { prisma } from "@/lib/db";

/**
 * Hashtags Instagram: extraction, limites et budget d'interrogation.
 *
 * Deux plafonds distincts, souvent confondus:
 *  - **30 hashtags par publication**, imposé par Instagram sur la légende;
 *  - **30 hashtags uniques interrogeables par 7 jours** via l'API (4.1.11),
 *    qui n'a rien à voir avec le premier et se consomme à la validation.
 */

export const MAX_HASHTAGS_PER_POST = 30;
export const HASHTAG_LOOKUP_BUDGET = 30;
const BUDGET_WINDOW_DAYS = 7;

/**
 * Extrait les hashtags d'une légende.
 *
 * Instagram accepte lettres, chiffres et tiret bas, y compris accentués. Un
 * croisillon collé à un mot précédent ne compte pas: `mot#tag` n'est pas un
 * hashtag pour Instagram non plus.
 */
export function extractHashtags(caption: string): string[] {
  const matches = caption.match(/(?:^|[\s.,;:!?()[\]{}"'—–-])#([\p{L}\p{N}_]+)/gu) ?? [];
  const names = matches.map((raw) => raw.slice(raw.indexOf("#") + 1).toLowerCase());
  return [...new Set(names)];
}

export type HashtagStatus = {
  name: string;
  /** null tant que le hashtag n'a jamais été vérifié. */
  known: boolean;
  valid: boolean;
  competition: number | null;
  checkedAt: Date | null;
};

export async function readCachedHashtags(
  channelAccountId: string,
  names: string[],
): Promise<Map<string, HashtagStatus>> {
  if (names.length === 0) return new Map();

  const rows = await prisma.instagramHashtag.findMany({
    where: { channelAccountId, name: { in: names } },
  });

  return new Map(
    rows.map((row) => [
      row.name,
      {
        name: row.name,
        known: true,
        valid: row.hashtagId !== null,
        competition: row.topMedianLikes,
        checkedAt: row.checkedAt,
      },
    ]),
  );
}

/** Hashtags uniques déjà interrogés dans la fenêtre glissante. */
export async function lookupBudgetUsed(channelAccountId: string): Promise<number> {
  const since = new Date(Date.now() - BUDGET_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return prisma.instagramHashtag.count({
    where: { channelAccountId, checkedAt: { gte: since } },
  });
}

export async function rememberHashtag(
  channelAccountId: string,
  name: string,
  hashtagId: string | null,
  competition: number | null,
): Promise<void> {
  await prisma.instagramHashtag.upsert({
    where: { channelAccountId_name: { channelAccountId, name } },
    create: { channelAccountId, name, hashtagId, topMedianLikes: competition },
    // `checkedAt` est réécrit: une revérification consomme bien du budget.
    update: { hashtagId, topMedianLikes: competition, checkedAt: new Date() },
  });
}
