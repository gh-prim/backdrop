"use server";

import { requireOrgContext } from "@/lib/session";
import { instagramAdapterFor } from "@/lib/channels/instagram-account";
import type {
  InstagramAudioDetail,
  InstagramAudioTrack,
  InstagramAudioType,
} from "@/lib/channels/instagram";
import { ChannelError } from "@/lib/channels/types";

export type AudioTrackWithCover = InstagramAudioTrack & {
  coverUrl: string | null;
};

export type AudioSearchResult =
  | { ok: true; tracks: AudioTrackWithCover[]; trending: boolean }
  | { ok: false; error: string };

/**
 * Cache des pochettes.
 *
 * La pochette n'est renvoyée que par l'endpoint de détail, pas par la
 * recherche: afficher une vignette par ligne coûte donc un appel par piste,
 * contre 200 par minute et par compte (4.3.4 pour Fanvue, même ordre chez
 * Meta). Le cache évite de repayer ce prix à chaque frappe dans la recherche.
 *
 * TTL court parce que les URL de Meta sont signées et expirent: garder une
 * pochette trop longtemps donnerait une image cassée plutôt qu'une économie.
 */
const COVER_TTL_MS = 10 * 60 * 1000;
const coverCache = new Map<string, { url: string | null; expiresAt: number }>();

async function withCovers(
  adapter: { getAudio: (id: string) => Promise<{ coverUrl: string | null }> },
  tracks: InstagramAudioTrack[],
): Promise<AudioTrackWithCover[]> {
  const now = Date.now();

  return Promise.all(
    tracks.map(async (track) => {
      const cached = coverCache.get(track.audioId);
      if (cached && cached.expiresAt > now) {
        return { ...track, coverUrl: cached.url };
      }

      try {
        const { coverUrl } = await adapter.getAudio(track.audioId);
        coverCache.set(track.audioId, {
          url: coverUrl,
          expiresAt: now + COVER_TTL_MS,
        });
        return { ...track, coverUrl };
      } catch {
        // Une pochette manquante ne doit jamais faire échouer la recherche.
        return { ...track, coverUrl: null };
      }
    }),
  );
}

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
  if (!adapter) return { ok: false, error: "Instagram channel not found." };

  try {
    const tracks = await adapter.searchAudio(query, audioType);
    return {
      ok: true,
      tracks: await withCovers(adapter, tracks),
      trending: query.trim().length === 0,
    };
  } catch (error) {
    const detail = error instanceof ChannelError ? error.message : String(error);
    return { ok: false, error: `Audio catalogue unavailable: ${detail}` };
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
  if (!adapter) return { ok: false, error: "Instagram channel not found." };

  try {
    return { ok: true, detail: await adapter.getAudio(audioId) };
  } catch (error) {
    const detail = error instanceof ChannelError ? error.message : String(error);
    return { ok: false, error: `Track unavailable: ${detail}` };
  }
}
