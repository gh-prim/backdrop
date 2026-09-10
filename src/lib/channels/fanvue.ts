import {
  ChannelError,
  type ChannelAdapter,
  type ChannelCapabilities,
  type PublishMetrics,
  type QuotaStatus,
} from "./types";
import { envOr } from "@/lib/env";

/**
 * Fanvue (spec 4.3).
 *
 * Deux axes de version, indépendants: le préfixe de chemin `/v1` et l'en-tête
 * `X-Fanvue-API-Version`. Les deux sont épinglés ici et nulle part ailleurs —
 * une version recopiée dans un appel est une version qu'on oubliera de faire
 * évoluer (4.3.1).
 */
export const FANVUE_API_VERSION = "2025-06-26";
const API_BASE = envOr("FANVUE_API_BASE", "https://api.fanvue.com");
const AUTH_BASE = envOr("FANVUE_AUTH_BASE", "https://auth.fanvue.com");
const V1 = "/v1";

/**
 * Le jeu minimal pour publier et lire ses revenus.
 *
 * `openid` et `offline_access` ne sont pas décoratifs: le premier ouvre
 * l'identité OIDC, le second est ce qui fait délivrer un refresh token. Sans
 * lui, la connexion expire au bout d'une heure et ne se renouvelle jamais.
 */
export const FANVUE_SCOPES = [
  "openid",
  "offline_access",
  "read:self",
  "read:media",
  "write:media",
  "read:post",
  "write:post",
  "read:insights",
] as const;

export const AUTHORIZE_URL = `${AUTH_BASE}/oauth2/auth`;
export const TOKEN_URL = `${AUTH_BASE}/oauth2/token`;

/** Plancher d'un contenu payant, en cents (4.3.7). */
export const MIN_PRICE_CENTS = 300;
/**
 * Plafond par défaut d'un pay-to-view en message.
 *
 * L'API ne le valide pas: un prix au-dessus est accepté, le message part, et
 * l'achat est refusé au fan — la créatrice ne gagne rien et personne n'est
 * prévenu. C'est donc à nous de refuser (4.3.10).
 */
export const MAX_DM_PRICE_CENTS = 50_000;

export type FanvueCredentials = {
  /** `uuid` de la créatrice, tel que rendu par `GET /v1/users/me`. */
  userUuid: string;
  handle: string;
  accessToken: string;
  /** À usage unique: chaque échange en rend un nouveau (4.3.3). */
  refreshToken: string;
  /** Epoch ms d'expiration de l'access token. */
  expiresAt: number;
  clientId: string;
  clientSecret: string;
};

export type FanvueMediaType = "image" | "video" | "audio" | "document";
export type FanvueAudience = "subscribers" | "followers-and-subscribers";
export type FanvueMediaStatus = "created" | "processing" | "ready" | "error";

export type UploadSession = {
  mediaUuid: string;
  uploadId: string;
  partSize: number;
  maxParts: number;
  totalParts: number | null;
};

export type CreatePostInput = {
  audience: FanvueAudience;
  text?: string;
  mediaUuids?: string[];
  mediaPreviewUuid?: string;
  /** Cents USD, minimum 300, exige des médias. */
  price?: number;
  collectionUuids?: string[];
};

export type FanvuePost = {
  uuid: string;
  createdAt: string;
  text: string | null;
  price: number | null;
  publishedAt: string | null;
};

/** Taille maximale acceptée par l'upload multipart: 1,5 Gio (4.3.5). */
export const MAX_UPLOAD_BYTES = 1_610_612_736;

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

/**
 * Échange un code d'autorisation contre un couple de jetons.
 *
 * Les identifiants client partent en Basic Auth et non dans le corps: c'est ce
 * que Fanvue impose, et l'envoyer dans le corps échoue avec une erreur qui ne
 * le dit pas (4.3.2).
 */
export async function exchangeCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return tokenRequest(params.clientId, params.clientSecret, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
}

export async function refreshTokens(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  return tokenRequest(params.clientId, params.clientSecret, {
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
}

async function tokenRequest(
  clientId: string,
  clientSecret: string,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    // Un refresh refusé n'est pas réessayable: le jeton à usage unique est
    // consommé, et seule une réautorisation manuelle répare (4.3.3).
    throw new ChannelError(`Fanvue token exchange failed (${response.status}).`, {
      retryable: false,
      code: "FANVUE_AUTH",
      details: text.slice(0, 300),
    });
  }
  return JSON.parse(text) as TokenResponse;
}

/**
 * Construit l'URL d'autorisation. PKCE est obligatoire côté Fanvue.
 */
export function authorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: (params.scopes ?? FANVUE_SCOPES).join(" "),
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${query.toString()}`;
}

export class FanvueAdapter implements ChannelAdapter {
  constructor(
    private readonly credentials: FanvueCredentials,
    /**
     * Appelé quand l'access token a été renouvelé, pour que l'appelant
     * persiste **immédiatement** le nouveau couple: le refresh token consommé
     * ne vaut plus rien, et le perdre coûte une réautorisation.
     */
    private readonly onTokens?: (next: FanvueCredentials) => Promise<void>,
  ) {}

  capabilities(): ChannelCapabilities {
    return {
      platform: "FANVUE",
      // Fanvue est le seul canal sans plafond de rating: c'est sa raison
      // d'être dans l'outil.
      maxRating: "NSFW",
      kinds: ["FV_POST", "FV_MASS_DM"],
      // Un post accepte plusieurs médias; la doc n'annonce pas de plafond.
      maxItems: 20,
      maxCaptionLength: 5000,
      // Les octets partent du worker: aucun cadrage imposé (4.3.5).
      ratios: [],
      requiresPublicUrl: false,
      // Existe (`publishAt`), délibérément inutilisé: l'horloge est à nous (4.3.8).
      nativeScheduling: true,
    };
  }

  /**
   * 200 requêtes par 60 s, par couple client/utilisateur (4.3.4).
   *
   * L'API n'expose pas de compteur interrogeable: la valeur n'est connue
   * qu'en réponse d'un appel réel, via les en-têtes. On annonce donc le
   * plafond et rien de plus, plutôt que d'inventer un `used`.
   */
  async checkQuota(): Promise<QuotaStatus> {
    return { used: 0, limit: 200, remaining: 200 };
  }

  async fetchMetrics(remoteId: string): Promise<PublishMetrics> {
    const post = await this.request<{
      likesCount?: number;
      commentsCount?: number;
      tipsCount?: number;
    }>("GET", `${V1}/posts/${remoteId}`);
    return {
      likes: post.likesCount ?? null,
      comments: post.commentsCount ?? null,
      tips: post.tipsCount ?? null,
    };
  }

  /** Identité de la créatrice autorisée. */
  async me(): Promise<{ uuid: string; handle: string; displayName?: string }> {
    return this.request("GET", `${V1}/users/me`);
  }

  /**
   * Upload en trois temps (4.3.5): ouverture de session, parts signées, clôture.
   *
   * Rendu en une seule méthode parce que les trois appels ne veulent rien dire
   * séparément: une session ouverte et non close laisse un média fantôme.
   */
  async uploadMedia(input: {
    name: string;
    filename: string;
    mediaType: FanvueMediaType;
    bytes: Uint8Array;
  }): Promise<string> {
    if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new ChannelError(
        `File too large for Fanvue: ${input.bytes.byteLength} bytes, ${MAX_UPLOAD_BYTES} allowed.`,
        { retryable: false, code: "FANVUE_MEDIA_TOO_LARGE" },
      );
    }

    const session = await this.request<UploadSession>("POST", `${V1}/media/uploads`, {
      name: input.name,
      filename: input.filename,
      mediaType: input.mediaType,
      sizeBytes: input.bytes.byteLength,
    });

    const total =
      session.totalParts ?? Math.ceil(input.bytes.byteLength / session.partSize);
    if (total > session.maxParts) {
      throw new ChannelError(
        `File needs ${total} parts, Fanvue allows ${session.maxParts}.`,
        { retryable: false, code: "FANVUE_MEDIA_TOO_LARGE" },
      );
    }

    const parts: { PartNumber: number; ETag: string }[] = [];
    for (let index = 0; index < total; index += 1) {
      const partNumber = index + 1;
      const url = await this.request<string>(
        "GET",
        `${V1}/media/uploads/${session.uploadId}/parts/${partNumber}/url`,
        undefined,
        "text",
      );

      const chunk = input.bytes.subarray(
        index * session.partSize,
        Math.min((index + 1) * session.partSize, input.bytes.byteLength),
      );

      // Pas d'en-tête d'autorisation sur l'URL signée: elle porte déjà sa
      // signature, et un Authorization la fait rejeter.
      //
      // `Buffer.from(...)` recopie la tranche dans son propre tampon: passer
      // la vue directement ferait remonter tout le fichier à chaque part.
      const put = await fetch(url.trim(), {
        method: "PUT",
        body: new Uint8Array(chunk).buffer as ArrayBuffer,
      });
      if (!put.ok) {
        throw new ChannelError(`Part ${partNumber} rejected (${put.status}).`, {
          retryable: put.status >= 500,
          code: "FANVUE_UPLOAD_PART",
        });
      }

      const etag = put.headers.get("etag");
      if (!etag) {
        throw new ChannelError(`Part ${partNumber} returned no ETag.`, {
          retryable: true,
          code: "FANVUE_UPLOAD_PART",
        });
      }
      parts.push({ PartNumber: partNumber, ETag: etag });
    }

    // `PartNumber`/`ETag` en casse S3, pas camelCase: c'est la forme que
    // l'API attend telle quelle (4.3.5).
    await this.request("PATCH", `${V1}/media/uploads/${session.uploadId}`, { parts });
    return session.mediaUuid;
  }

  /** État d'un média. Sans `variants`, la réponse ne porte aucune URL (4.3.6). */
  async mediaStatus(mediaUuid: string): Promise<FanvueMediaStatus> {
    const media = await this.request<{ status: string }>(
      "GET",
      `${V1}/media/${mediaUuid}`,
    );
    // La doc mélange `ready` et `FINALISED` pour le même état (4.3.5).
    const status = media.status?.toLowerCase();
    return status === "finalised" ? "ready" : (status as FanvueMediaStatus);
  }

  async createPost(input: CreatePostInput): Promise<FanvuePost> {
    if (input.price !== undefined) {
      if (input.price < MIN_PRICE_CENTS) {
        throw new ChannelError(
          `A paid post starts at ${MIN_PRICE_CENTS} cents.`,
          { retryable: false, code: "FANVUE_PRICE" },
        );
      }
      if (!input.mediaUuids?.length) {
        throw new ChannelError("A paid post requires media.", {
          retryable: false,
          code: "FANVUE_PRICE",
        });
      }
    }

    // `publishAt` est délibérément absent: l'échéance est tenue par
    // l'application, sur tous les canaux (4.3.8).
    return this.request<FanvuePost>("POST", `${V1}/posts`, {
      audience: input.audience,
      ...(input.text ? { text: input.text } : {}),
      ...(input.mediaUuids?.length ? { mediaUuids: input.mediaUuids } : {}),
      ...(input.mediaPreviewUuid ? { mediaPreviewUuid: input.mediaPreviewUuid } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.collectionUuids?.length
        ? { collectionUuids: input.collectionUuids }
        : {}),
    });
  }

  /**
   * Posts récents, pour retrouver un POST déjà passé avant de le rejouer.
   *
   * L'API n'a pas d'idempotence sur la création (4.3.9): un timeout après un
   * appel déjà traité produirait un doublon au retry. C'est cette lecture qui
   * l'évite.
   */
  async recentPosts(size = 10): Promise<FanvuePost[]> {
    const page = await this.request<{ data: FanvuePost[] }>(
      "GET",
      `${V1}/posts?size=${size}`,
    );
    return page.data ?? [];
  }

  private async accessToken(): Promise<string> {
    // Marge d'une minute: un jeton qui expire pendant l'appel coûte un 401
    // et un retry, pour une seconde gagnée.
    if (this.credentials.expiresAt > Date.now() + 60_000) {
      return this.credentials.accessToken;
    }

    const tokens = await refreshTokens({
      clientId: this.credentials.clientId,
      clientSecret: this.credentials.clientSecret,
      refreshToken: this.credentials.refreshToken,
    });

    this.credentials.accessToken = tokens.access_token;
    this.credentials.refreshToken =
      tokens.refresh_token ?? this.credentials.refreshToken;
    this.credentials.expiresAt = Date.now() + tokens.expires_in * 1000;

    // Persistance immédiate: l'ancien refresh token vient d'être consommé.
    await this.onTokens?.({ ...this.credentials });
    return this.credentials.accessToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    as: "json" | "text" = "json",
  ): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "X-Fanvue-API-Version": FANVUE_API_VERSION,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) throw await this.toError(response, path);
    const text = await response.text();
    return (as === "text" ? text : text ? JSON.parse(text) : {}) as T;
  }

  private async toError(response: Response, path: string): Promise<ChannelError> {
    const body = (await response.text()).slice(0, 400);

    if (response.status === 429) {
      // Le backoff est dicté par le serveur, comme FLOOD_WAIT côté Telegram.
      const retryAfter = response.headers.get("retry-after");
      return new ChannelError(
        `Fanvue rate limit on ${path}${retryAfter ? `, retry after ${retryAfter}s` : ""}.`,
        { retryable: true, code: "FANVUE_RATE_LIMIT", details: retryAfter },
      );
    }

    if (response.status === 410) {
      // Version d'API retirée: aucun retry ne réparera, il faut relever
      // FANVUE_API_VERSION (4.3.1).
      return new ChannelError(
        `Fanvue API version ${FANVUE_API_VERSION} is gone. ${body}`,
        { retryable: false, code: "FANVUE_VERSION_GONE", details: body },
      );
    }

    if (response.status === 401 || response.status === 403) {
      return new ChannelError(`Fanvue refused the call on ${path} (${response.status}).`, {
        retryable: false,
        code: "FANVUE_AUTH",
        details: body,
      });
    }

    return new ChannelError(`Fanvue ${response.status} on ${path}.`, {
      // 5xx seulement: une 400 ne se répare pas en réessayant.
      retryable: response.status >= 500,
      code: "FANVUE_HTTP",
      details: body,
    });
  }
}
