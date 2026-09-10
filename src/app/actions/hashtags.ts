"use server";

import { requireOrgContext } from "@/lib/session";
import { instagramAdapterFor } from "@/lib/channels/instagram-account";
import { ChannelError } from "@/lib/channels/types";
import {
  HASHTAG_LOOKUP_BUDGET,
  listKnownHashtags,
  lookupBudgetUsed,
  readCachedHashtags,
  rememberHashtag,
} from "@/lib/hashtags";

export type KnownHashtag = {
  name: string;
  competition: number | null;
};

/** Hashtags déjà connus du compte: les reprendre ne coûte rien (4.1.11). */
export async function listKnownHashtagsAction(
  channelAccountId: string,
): Promise<{ hashtags: KnownHashtag[]; budgetUsed: number; budgetTotal: number }> {
  await requireOrgContext();
  const [hashtags, budgetUsed] = await Promise.all([
    listKnownHashtags(channelAccountId),
    lookupBudgetUsed(channelAccountId),
  ]);

  return {
    hashtags: hashtags.map(({ name, competition }) => ({ name, competition })),
    budgetUsed,
    budgetTotal: HASHTAG_LOOKUP_BUDGET,
  };
}

export type AddHashtagResult =
  | { ok: true; hashtag: KnownHashtag; budgetUsed: number }
  | { ok: false; error: string };

/**
 * Ajoute un hashtag encore inconnu, en consommant une interrogation.
 *
 * C'est la seule opération qui entame le budget hebdomadaire. Un hashtag déjà
 * connu est renvoyé tel quel, sans rien consommer.
 */
export async function addHashtagAction(
  channelAccountId: string,
  raw: string,
): Promise<AddHashtagResult> {
  const ctx = await requireOrgContext();

  const name = raw.trim().replace(/^#/, "").toLowerCase();
  if (!/^[\p{L}\p{N}_]+$/u.test(name)) {
    return { ok: false, error: "Letters, digits and underscores only." };
  }

  const cached = await readCachedHashtags(channelAccountId, [name]);
  const known = cached.get(name);
  if (known) {
    if (!known.valid) {
      return { ok: false, error: `Instagram does not know #${name}.` };
    }
    return {
      ok: true,
      hashtag: { name, competition: known.competition },
      budgetUsed: await lookupBudgetUsed(channelAccountId),
    };
  }

  const used = await lookupBudgetUsed(channelAccountId);
  if (used >= HASHTAG_LOOKUP_BUDGET) {
    return {
      ok: false,
      error: `Weekly lookup budget spent (${used}/${HASHTAG_LOOKUP_BUDGET}). Already-known hashtags stay free.`,
    };
  }

  const adapter = await instagramAdapterFor(ctx, channelAccountId);
  if (!adapter) return { ok: false, error: "Instagram channel not found." };

  try {
    const hashtagId = await adapter.searchHashtag(name);
    const competition = hashtagId ? await adapter.hashtagCompetition(hashtagId) : null;
    await rememberHashtag(channelAccountId, name, hashtagId, competition);

    if (!hashtagId) return { ok: false, error: `Instagram does not know #${name}.` };

    return {
      ok: true,
      hashtag: { name, competition },
      budgetUsed: used + 1,
    };
  } catch (error) {
    const detail = error instanceof ChannelError ? error.message : String(error);
    return { ok: false, error: `Hashtag "${name}": ${detail}` };
  }
}
