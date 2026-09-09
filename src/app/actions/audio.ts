"use server";

import { requireOrgContext } from "@/lib/session";
import { instagramAdapterFor } from "@/lib/channels/instagram-account";
import type {
  InstagramAudioDetail,
  InstagramAudioTrack,
  InstagramAudioType,
} from "@/lib/channels/instagram";
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
  audioType: InstagramAudioType = "music",
): Promise<AudioSearchResult> {
  const ctx = await requireOrgContext();

  const adapter = await instagramAdapterFor(ctx, channelAccountId);
  if (!adapter) return { ok: false, error: "Canal Instagram introuvable." };

  try {
    const tracks = await adapter.searchAudio(query, audioType);
    return { ok: true, tracks, trending: query.trim().length === 0 };
  } catch (error) {
    const detail = error instanceof ChannelError ? error.message : String(error);
    return { ok: false, error: `Catalogue audio indisponible: ${detail}` };
  }
}

export type AudioPreviewResult =
  | { ok: true; detail: InstagramAudioDetail }
  | { ok: false; error: string };

/**
 * Détail d'une piste, pour l'écoute.
 *
 * `downloadUrl` est nul sur la musique sous licence: Meta n'en distribue pas
 * les masters. L'interface bascule alors sur le lien vers la page Instagram,
 * seul moyen d'entendre la piste avant de publier.
 */
export async function getInstagramAudioAction(
  channelAccountId: string,
  audioId: string,
): Promise<AudioPreviewResult> {
  const ctx = await requireOrgContext();

  const adapter = await instagramAdapterFor(ctx, channelAccountId);
  if (!adapter) return { ok: false, error: "Canal Instagram introuvable." };

  try {
    return { ok: true, detail: await adapter.getAudio(audioId) };
  } catch (error) {
    const detail = error instanceof ChannelError ? error.message : String(error);
    return { ok: false, error: `Piste indisponible: ${detail}` };
  }
}
