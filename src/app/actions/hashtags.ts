"use server";

import { requireOrgContext } from "@/lib/session";
import { instagramAdapterFor } from "@/lib/channels/instagram-account";
import { ChannelError } from "@/lib/channels/types";
import {
  HASHTAG_LOOKUP_BUDGET,
  extractHashtags,
  lookupBudgetUsed,
  readCachedHashtags,
  rememberHashtag,
  type HashtagStatus,
} from "@/lib/hashtags";

export type HashtagReport = {
  ok: true;
  hashtags: (HashtagStatus & { known: boolean })[];
  budgetUsed: number;
  budgetTotal: number;
  /** Hashtags laissés non vérifiés faute de budget. */
  skipped: string[];
};

export type HashtagResult = HashtagReport | { ok: false; error: string };

/** État connu des hashtags d'une légende, sans consommer de budget. */
export async function readHashtagsAction(
  channelAccountId: string,
  caption: string,
): Promise<HashtagResult> {
  await requireOrgContext();
  const names = extractHashtags(caption);
  const cached = await readCachedHashtags(channelAccountId, names);

  return {
    ok: true,
    hashtags: names.map(
      (name) =>
        cached.get(name) ?? {
          name,
          known: false,
          valid: false,
          competition: null,
          checkedAt: null,
        },
    ),
    budgetUsed: await lookupBudgetUsed(channelAccountId),
    budgetTotal: HASHTAG_LOOKUP_BUDGET,
    skipped: [],
  };
}

/**
 * Vérifie les hashtags encore inconnus auprès d'Instagram.
 *
 * Ne touche que ceux absents du cache, et s'arrête net quand le budget
 * hebdomadaire est épuisé plutôt que d'encaisser une erreur de quota: les
 * hashtags laissés de côté sont renvoyés pour que l'opérateur sache lesquels.
 */
export async function checkHashtagsAction(
  channelAccountId: string,
  caption: string,
): Promise<HashtagResult> {
  const ctx = await requireOrgContext();

  const adapter = await instagramAdapterFor(ctx, channelAccountId);
  if (!adapter) return { ok: false, error: "Instagram channel not found." };

  const names = extractHashtags(caption);
  const cached = await readCachedHashtags(channelAccountId, names);
  const unknown = names.filter((name) => !cached.has(name));

  let used = await lookupBudgetUsed(channelAccountId);
  const skipped: string[] = [];

  for (const name of unknown) {
    if (used >= HASHTAG_LOOKUP_BUDGET) {
      skipped.push(name);
      continue;
    }

    try {
      const hashtagId = await adapter.searchHashtag(name);
      const competition = hashtagId ? await adapter.hashtagCompetition(hashtagId) : null;
      await rememberHashtag(channelAccountId, name, hashtagId, competition);
      used += 1;
    } catch (error) {
      const detail = error instanceof ChannelError ? error.message : String(error);
      return { ok: false, error: `Hashtag "${name}": ${detail}` };
    }
  }

  const refreshed = await readCachedHashtags(channelAccountId, names);
  return {
    ok: true,
    hashtags: names.map(
      (name) =>
        refreshed.get(name) ?? {
          name,
          known: false,
          valid: false,
          competition: null,
          checkedAt: null,
        },
    ),
    budgetUsed: used,
    budgetTotal: HASHTAG_LOOKUP_BUDGET,
    skipped,
  };
}
