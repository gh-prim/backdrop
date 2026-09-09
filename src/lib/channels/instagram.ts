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
const GRAPH_BASE = "https://graph.facebook.com";

export type InstagramCredentials = {
  /** ig_user_id, l'identifiant du compte professionnel. */
  igUserId: string;
  /** Long-lived token, 60 jours (4.1.9). */
  accessToken: string;
  pageId?: string;
};

export type ContainerStatus =
  | "IN_PROGRESS"
  | "FINISHED"
  | "ERROR"
  | "EXPIRED"
  | "PUBLISHED";

export type CreateContainerInput =
  | { type: "IMAGE"; imageUrl: string; caption?: string }
  | { type: "VIDEO"; videoUrl: string; caption?: string }
  | { type: "REELS"; videoUrl: string; caption?: string; audioId?: string }
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
        break;
      case "VIDEO":
        params.media_type = "VIDEO";
        params.video_url = input.videoUrl;
        params.caption = input.caption;
        break;
      case "REELS":
        params.media_type = "REELS";
        params.video_url = input.videoUrl;
        params.caption = input.caption;
        if (input.audioId) {
          // Piste native du catalogue Instagram, Reels uniquement (4.1.5).
          // Aucune prévisualisation possible: ce qui est configuré part tel quel.
          params.audio_configuration = JSON.stringify({
            audio_id: input.audioId,
            audio_volume: 80,
            video_volume: 40,
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
