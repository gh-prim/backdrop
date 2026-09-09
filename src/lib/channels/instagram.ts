import {
  ChannelError,
  type ChannelAdapter,
  type ChannelCapabilities,
  type PublishMetrics,
  type QuotaStatus,
} from "./types";

/**
 * Instagram API with Facebook Login (4.1).
 *
 * L'app Meta reste en mode développement: chaque compte est ajouté comme
 * tester, ce qui débloque `instagram_content_publish` sans App Review (4.1.2).
 * Rien ici ne doit dépendre d'une permission qui exigerait une review.
 */

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v25.0";

/**
 * Base de l'API Graph. Surchargeable pour pointer un double local et exercer
 * toute la chaîne sans compte Instagram réel (scripts/dev-graph-stub.ts).
 * En production, la valeur par défaut est la seule correcte.
 */
const GRAPH_BASE = process.env.META_GRAPH_BASE ?? "https://graph.facebook.com";

export type InstagramCredentials = {
  /** ig_user_id, l'identifiant du compte professionnel. */
  igUserId: string;
  /** Long-lived token, 60 jours (4.1.9). */
  accessToken: string;
  pageId?: string;
};

/**
 * Auto-déclaration de contenu généré par IA (`is_ai_generated`).
 *
 * Backdrop n'existe que pour administrer des influenceurs virtuels: **toutes**
 * les publications sont générées. Le paramètre est donc posé systématiquement
 * plutôt qu'offert en case à cocher, pour la même raison que le rating
 * d'Instagram est verrouillé à SFW: ce qui peut être oublié finira par l'être.
 *
 * Meta étiquette aussi automatiquement quand il détecte des métadonnées IA
 * standard dans le fichier. On ne peut pas compter dessus ici: le réencodage
 * ffmpeg des Variants les efface. L'auto-déclaration est le seul rail fiable.
 *
 * Le paramètre n'est pas accepté sur les enfants d'un carrousel: l'étiquette
 * appartient au container parent.
 */
const AI_GENERATED = "true";

export type ContainerStatus =
  | "IN_PROGRESS"
  | "FINISHED"
  | "ERROR"
  | "EXPIRED"
  | "PUBLISHED";

/** Piste du catalogue Instagram, telle que renvoyée par `GET /ig_audio`. */
export type InstagramAudioTrack = {
  audioId: string;
  title: string;
  artist: string;
  durationMs: number;
  /** Page de l'audio sur Instagram, utile pour écouter avant de choisir. */
  previewUrl: string | null;
  creatorHandle: string | null;
};

export type CreateContainerInput =
  | { type: "IMAGE"; imageUrl: string; caption?: string }
  | { type: "VIDEO"; videoUrl: string; caption?: string }
  | {
      type: "REELS";
      videoUrl: string;
      caption?: string;
      audioId?: string;
      audioVolume?: number;
      videoVolume?: number;
    }
  | { type: "CAROUSEL_ITEM_IMAGE"; imageUrl: string }
  | { type: "CAROUSEL_ITEM_VIDEO"; videoUrl: string }
  | { type: "CAROUSEL"; children: string[]; caption?: string };

/** Injectable pour les tests: on ne parle jamais au vrai Graph en CI. */
export type GraphFetch = (
  url: string,
  init?: { method?: string; body?: URLSearchParams },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

/**
 * Classement des codes d'erreur Graph.
 *
 * Réessayer une erreur de quota ou de token ne fait que consommer des
 * tentatives: la seule issue est humaine ou différée.
 */
const NON_RETRYABLE_CODES = new Set([
  9, // publication limite atteinte (4.1.8)
  10, // permission manquante
  100, // paramètre invalide
  190, // token invalide ou expiré
  200, // permission insuffisante
  2207026, // format vidéo non supporté (4.1.7)
]);

const RETRYABLE_CODES = new Set([
  1, // erreur inconnue, transitoire
  2, // service temporairement indisponible
  4, // limite de débit applicative
  17, // limite de débit utilisateur
  32, // limite de débit de page
  341, // limite atteinte, réessayable plus tard
]);

function graphError(status: number, body: unknown): ChannelError {
  const error = (body as GraphErrorBody)?.error;
  const code = error?.code;
  const message =
    error?.error_user_msg ??
    error?.message ??
    `Réponse Graph inattendue (HTTP ${status}).`;

  const retryable =
    code !== undefined && NON_RETRYABLE_CODES.has(code)
      ? false
      : code !== undefined && RETRYABLE_CODES.has(code)
        ? true
        : status >= 500 || status === 429;

  return new ChannelError(message, {
    retryable,
    code: code !== undefined ? `graph_${code}` : `http_${status}`,
    details: error,
  });
}

export class InstagramAdapter implements ChannelAdapter {
  constructor(
    private readonly credentials: InstagramCredentials,
    private readonly http: GraphFetch = defaultGraphFetch,
  ) {}

  capabilities(): ChannelCapabilities {
    return {
      platform: "INSTAGRAM",
      // Non négociable: le garde-fou de la section 9 commence ici.
      maxRating: "SFW",
      kinds: ["SINGLE", "CAROUSEL", "REEL"],
      maxItems: 10,
      maxCaptionLength: 2200,
      ratios: ["1:1", "4:5", "9:16"],
      requiresPublicUrl: true,
      nativeScheduling: false,
    };
  }

  private url(path: string): string {
    return `${GRAPH_BASE}/${GRAPH_VERSION}/${path}`;
  }

  private async call<T>(
    path: string,
    params: Record<string, string | undefined>,
    method: "GET" | "POST" = "GET",
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, value);
    }
    search.set("access_token", this.credentials.accessToken);

    const response =
      method === "GET"
        ? await this.http(`${this.url(path)}?${search.toString()}`)
        : await this.http(this.url(path), { method: "POST", body: search });

    const body = await response.json();
    if (!response.ok) throw graphError(response.status, body);
    return body as T;
  }

  /**
   * Quota de publication (4.1.8). Le plafond est celui que Meta annonce, pas
   * une constante recopiée: il a déjà changé une fois.
   */
  async checkQuota(): Promise<QuotaStatus> {
    const body = await this.call<{
      data?: { quota_usage?: number; config?: { quota_total?: number } }[];
    }>(`${this.credentials.igUserId}/content_publishing_limit`, {
      fields: "config,quota_usage",
    });

    const row = body.data?.[0];
    const used = row?.quota_usage ?? 0;
    const limit = row?.config?.quota_total ?? 50;
    return { used, limit, remaining: Math.max(0, limit - used) };
  }

  /** Premier temps: création du container (4.1.3). */
  async createContainer(input: CreateContainerInput): Promise<string> {
    const params: Record<string, string | undefined> = {};

    switch (input.type) {
      case "IMAGE":
        params.image_url = input.imageUrl;
        params.caption = input.caption;
        params.is_ai_generated = AI_GENERATED;
        break;
      case "VIDEO":
        params.media_type = "VIDEO";
        params.video_url = input.videoUrl;
        params.caption = input.caption;
        params.is_ai_generated = AI_GENERATED;
        break;
      case "REELS":
        params.media_type = "REELS";
        params.video_url = input.videoUrl;
        params.caption = input.caption;
        params.is_ai_generated = AI_GENERATED;
        if (input.audioId) {
          // Piste native du catalogue Instagram, Reels uniquement (4.1.5).
          // Ce n'est pas qu'une question de son: un Reel avec piste native
          // apparaît sur la page de cet audio, donc dans une surface de
          // découverte qu'une musique incrustée au montage n'atteint jamais.
          params.audio_configuration = JSON.stringify({
            audio_id: input.audioId,
            audio_volume: input.audioVolume ?? 100,
            video_volume: input.videoVolume ?? 0,
          });
        }
        break;
      case "CAROUSEL_ITEM_IMAGE":
        params.is_carousel_item = "true";
        params.image_url = input.imageUrl;
        break;
      case "CAROUSEL_ITEM_VIDEO":
        params.is_carousel_item = "true";
        params.media_type = "VIDEO";
        params.video_url = input.videoUrl;
        break;
      case "CAROUSEL":
        params.media_type = "CAROUSEL";
        params.children = input.children.join(",");
        // La légende est portée par le parent, jamais par les enfants (4.1.4).
        params.caption = input.caption;
        // L'étiquette IA aussi: elle vaut pour le carrousel entier.
        params.is_ai_generated = AI_GENERATED;
        break;
    }

    const body = await this.call<{ id?: string }>(
      `${this.credentials.igUserId}/media`,
      params,
      "POST",
    );

    if (!body.id) {
      throw new ChannelError("Container créé sans identifiant.", {
        retryable: false,
        code: "missing_creation_id",
        details: body,
      });
    }
    return body.id;
  }

  /**
   * Deuxième temps: polling. Obligatoire pour les vidéos et les reels, et
   * jamais optionnel pour un carrousel dont tous les enfants doivent être
   * FINISHED avant la création du parent (4.1.3, 4.1.4).
   */
  async getContainerStatus(
    containerId: string,
  ): Promise<{ status: ContainerStatus; error?: string }> {
    const body = await this.call<{
      status_code?: ContainerStatus;
      status?: string;
    }>(containerId, { fields: "status_code,status" });

    return {
      status: body.status_code ?? "IN_PROGRESS",
      error: body.status,
    };
  }

  /** Troisième temps: publication effective. */
  async publishContainer(creationId: string): Promise<string> {
    const body = await this.call<{ id?: string }>(
      `${this.credentials.igUserId}/media_publish`,
      { creation_id: creationId },
      "POST",
    );

    if (!body.id) {
      throw new ChannelError("Publication sans media_id en retour.", {
        retryable: false,
        code: "missing_media_id",
        details: body,
      });
    }
    return body.id;
  }

  /**
   * Catalogue audio (4.1.5). Sans `query`, l'API renvoie les tendances.
   *
   * Le catalogue exposé est plus restreint que celui de l'app mobile, et
   * aucune prévisualisation n'est possible depuis l'API: `previewUrl` renvoie
   * vers la page Instagram de la piste, seul moyen de l'écouter avant de
   * publier. Ce qui est configuré part en production tel quel.
   */
  async searchAudio(query?: string): Promise<InstagramAudioTrack[]> {
    const body = await this.call<{
      audio?: {
        audio_id?: string;
        title?: string;
        display_artist?: string;
        duration_in_ms?: number;
        on_platform_audio_preview_link?: string;
        ig_username?: string;
      }[];
    }>("ig_audio", {
      audio_type: "music",
      user_id: this.credentials.igUserId,
      // La clé de réponse est `audio`, pas `data`: cet endpoint ne suit pas la
      // convention du reste du Graph.
      search_query: query?.trim() || undefined,
    });

    return (body.audio ?? [])
      .filter((track) => track.audio_id)
      .map((track) => ({
        audioId: track.audio_id as string,
        title: track.title ?? "(sans titre)",
        artist: track.display_artist ?? "",
        durationMs: track.duration_in_ms ?? 0,
        previewUrl: track.on_platform_audio_preview_link ?? null,
        creatorHandle: track.ig_username ?? null,
      }));
  }

  async fetchMetrics(remoteId: string): Promise<PublishMetrics> {
    const body = await this.call<{
      id?: string;
      like_count?: number;
      comments_count?: number;
      media_product_type?: string;
      permalink?: string;
      timestamp?: string;
    }>(remoteId, {
      fields: "id,like_count,comments_count,media_product_type,permalink,timestamp",
    });

    return {
      likeCount: body.like_count ?? null,
      commentsCount: body.comments_count ?? null,
      // REELS n'est pas un vrai media type: après publication l'API renvoie
      // VIDEO. C'est media_product_type qui distingue (4.1.4).
      mediaProductType: body.media_product_type ?? null,
      permalink: body.permalink ?? null,
      publishedAt: body.timestamp ?? null,
    };
  }

  /**
   * Échange d'un long-lived token contre un nouveau (4.1.9). Sans ce
   * rafraîchissement, la pipeline meurt silencieusement au bout de 60 jours.
   */
  async refreshLongLivedToken(): Promise<{
    accessToken: string;
    expiresAt: Date;
  }> {
    const body = await this.call<{
      access_token?: string;
      expires_in?: number;
    }>("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: this.credentials.accessToken,
    });

    if (!body.access_token) {
      throw new ChannelError("Rafraîchissement sans token en retour.", {
        retryable: false,
        code: "missing_access_token",
        details: body,
      });
    }

    const expiresIn = body.expires_in ?? 60 * 24 * 60 * 60;
    return {
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }
}

const defaultGraphFetch: GraphFetch = async (url, init) => {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    body: init?.body,
  });
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
  };
};
