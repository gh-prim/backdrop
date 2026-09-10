import "server-only";
import { prisma } from "@/lib/db";
import { HASHTAG_LIMIT, MAX_HASHTAGS_PER_POST, extractHashtags } from "@/lib/hashtags-shared";

export { HASHTAG_LIMIT, MAX_HASHTAGS_PER_POST, extractHashtags };

/**
 * Hashtags Instagram: extraction, limites et budget d'interrogation.
 *
 * Deux plafonds distincts, souvent confondus:
 *  - **30 hashtags par publication**, imposé par Instagram sur la légende;
 *  - **30 hashtags uniques interrogeables par 7 jours** via l'API (4.1.11),
 *    qui n'a rien à voir avec le premier et se consomme à la validation.
 */

export const HASHTAG_LOOKUP_BUDGET = 30;
const BUDGET_WINDOW_DAYS = 7;

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


/**
 * Hashtags déjà validés pour ce compte.
 *
 * Ce sont eux qu'on propose en premier: leur identifiant Meta est en base, donc
 * les reprendre ne coûte **rien** au budget hebdomadaire. C'est ce qui rend la
 * limite des 30 interrogations par semaine supportable — on ne la consomme
 * qu'une fois par hashtag, la première.
 */
export async function listKnownHashtags(channelAccountId: string) {
  const rows = await prisma.instagramHashtag.findMany({
    where: { channelAccountId, hashtagId: { not: null } },
    orderBy: [{ topMedianLikes: "desc" }, { name: "asc" }],
    select: { name: true, topMedianLikes: true, checkedAt: true },
  });

  return rows.map((row) => ({
    name: row.name,
    competition: row.topMedianLikes,
    checkedAt: row.checkedAt,
  }));
}

/**
 * Assemble la légende Instagram.
 *
 * L'API n'a pas de champ hashtag: ils doivent figurer dans la légende pour
 * fonctionner (4.1.11). Ils sont donc concaténés ici, **et seulement pour
 * Instagram** — la légende commune reste propre pour Telegram et Fanvue.
 */
export function captionWithHashtags(caption: string, hashtags: string[]): string {
  // Un hashtag déjà tapé dans la légende ne doit pas être ajouté une seconde
  // fois: il compterait deux fois dans le plafond pour aucun effet.
  const already = new Set(extractHashtags(caption));
  const extra = hashtags
    .map((name) => name.toLowerCase())
    .filter((name) => !already.has(name));

  if (extra.length === 0) return caption;
  const tags = extra.map((name) => `#${name}`).join(" ");
  return caption.trim().length > 0 ? `${caption.trim()}\n\n${tags}` : tags;
}

/**
 * Nombre de hashtags que portera réellement la publication Instagram.
 *
 * Compte ceux tapés dans la légende commune **et** ceux choisis dans l'onglet,
 * sans doublon. Compter les seconds seuls laisserait passer un dépassement
 * qu'Instagram refuserait à l'envoi, très loin de sa cause.
 */
export function totalHashtags(caption: string, picked: string[]): number {
  return extractHashtags(captionWithHashtags(caption, picked)).length;
}
