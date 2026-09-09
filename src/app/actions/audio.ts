"use server";

import { requireOrgContext } from "@/lib/session";
import { instagramAdapterFor } from "@/lib/channels/instagram-account";
import type { InstagramAudioTrack } from "@/lib/channels/instagram";
import { ChannelError } from "@/lib/channels/types";

export type AudioSearchResult =
  | { ok: true; tracks: InstagramAudioTrack[]; trending: boolean }
  | { ok: false; error: string };

/**
 * Recherche dans le catalogue audio d'Instagram.
 *
 * Requête vide: l'API renvoie les tendances, ce qui fait de l'écran d'accueil
 * du sélecteur une vitrine utile plutôt qu'un champ vide.
 */
export async function searchInstagramAudioAction(
  channelAccountId: string,
  query: string,
): Promise<AudioSearchResult> {
  const ctx = await requireOrgContext();

  const adapter = await instagramAdapterFor(ctx, channelAccountId);
  if (!adapter) return { ok: false, error: "Canal Instagram introuvable." };

  try {
    const tracks = await adapter.searchAudio(query);
    return { ok: true, tracks, trending: query.trim().length === 0 };
  } catch (error) {
    const detail = error instanceof ChannelError ? error.message : String(error);
    return { ok: false, error: `Catalogue audio indisponible: ${detail}` };
  }
}
