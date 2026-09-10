import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FanvueAdapter,
  FANVUE_API_VERSION,
  MIN_PRICE_CENTS,
  authorizeUrl,
  type FanvueCredentials,
} from "@/lib/channels/fanvue";
import { ChannelError } from "@/lib/channels/types";

/**
 * L'adapter est testé contre un double de `fetch`: ce qui compte ici est la
 * grammaire des appels — en-tête de version, upload en trois temps, refus des
 * prix impossibles — pas le comportement de Fanvue, qu'on ne peut pas exercer
 * sans compte réel.
 */

function credentials(overrides: Partial<FanvueCredentials> = {}): FanvueCredentials {
  return {
    userUuid: "creator-uuid",
    handle: "carolina",
    accessToken: "jeton-valide",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 3_600_000,
    clientId: "client",
    clientSecret: "secret",
    ...overrides,
  };
}

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];

function respond(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(handler: (url: string, init: RequestInit) => Response) {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
}

describe("adapter Fanvue", () => {
  it("épingle la version d'API sur chaque appel", async () => {
    stub(() => respond({ uuid: "u", handle: "carolina" }));

    await new FanvueAdapter(credentials()).me();

    const headers = calls[0].init.headers as Record<string, string>;
    // Absente ou inconnue, l'en-tête vaut 400: c'est la première chose que
    // vérifie Fanvue, avant même l'autorisation (4.3.1).
    expect(headers["X-Fanvue-API-Version"]).toBe(FANVUE_API_VERSION);
    expect(headers.Authorization).toBe("Bearer jeton-valide");
  });

  it("téléverse en trois temps et rend l'uuid du média", async () => {
    stub((url, init) => {
      if (url.endsWith("/v1/media/uploads") && init.method === "POST") {
        return respond({
          mediaUuid: "media-1",
          uploadId: "upload-1",
          partSize: 4,
          maxParts: 100,
          totalParts: 2,
        });
      }
      if (url.includes("/parts/")) return respond("https://s3.example/part");
      if (url.startsWith("https://s3.example"))
        return respond("", { headers: { etag: '"abc"' } });
      return respond({});
    });

    const mediaUuid = await new FanvueAdapter(credentials()).uploadMedia({
      name: "test",
      filename: "test.jpg",
      mediaType: "image",
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7]),
    });

    expect(mediaUuid).toBe("media-1");
    // Session, deux URLs signées, deux PUT, clôture: sept octets pour une
    // taille de part de quatre font bien deux parts.
    expect(calls).toHaveLength(6);

    const close = calls.at(-1)!;
    expect(close.init.method).toBe("PATCH");
    // Casse S3, pas camelCase: l'API refuse `partNumber` (4.3.5).
    expect(JSON.parse(String(close.init.body))).toEqual({
      parts: [
        { PartNumber: 1, ETag: '"abc"' },
        { PartNumber: 2, ETag: '"abc"' },
      ],
    });
  });

  it("refuse un post payant sous le plancher, sans appeler l'API", async () => {
    stub(() => respond({}));

    await expect(
      new FanvueAdapter(credentials()).createPost({
        audience: "subscribers",
        mediaUuids: ["m"],
        price: MIN_PRICE_CENTS - 1,
      }),
    ).rejects.toBeInstanceOf(ChannelError);

    expect(calls).toHaveLength(0);
  });

  it("refuse un prix sans média: rien ne serait déverrouillable", async () => {
    stub(() => respond({}));

    await expect(
      new FanvueAdapter(credentials()).createPost({
        audience: "subscribers",
        price: 500,
      }),
    ).rejects.toBeInstanceOf(ChannelError);
  });

  it("renouvelle le jeton expiré et rend le nouveau couple à l'appelant", async () => {
    const persisted: FanvueCredentials[] = [];
    stub((url) => {
      if (url.includes("/oauth2/token")) {
        return respond({
          access_token: "jeton-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
        });
      }
      return respond({ uuid: "u", handle: "carolina" });
    });

    const adapter = new FanvueAdapter(
      credentials({ expiresAt: Date.now() - 1000 }),
      async (next) => {
        persisted.push(next);
      },
    );
    await adapter.me();

    // Le refresh token est à usage unique: le nouveau doit être persisté
    // immédiatement, sans quoi la chaîne est cassée (4.3.3).
    expect(persisted).toHaveLength(1);
    expect(persisted[0].refreshToken).toBe("refresh-2");
    expect(persisted[0].accessToken).toBe("jeton-2");
  });

  it("traite un 429 comme réessayable et un 400 comme définitif", async () => {
    stub(() => respond({ error: "slow down" }, { status: 429, headers: { "retry-after": "30" } }));
    await new FanvueAdapter(credentials())
      .me()
      .catch((error: ChannelError) => {
        expect(error.retryable).toBe(true);
        expect(error.code).toBe("FANVUE_RATE_LIMIT");
      });

    stub(() => respond({ error: "bad" }, { status: 400 }));
    await new FanvueAdapter(credentials())
      .me()
      .catch((error: ChannelError) => expect(error.retryable).toBe(false));
  });

  it("construit une URL d'autorisation avec PKCE", () => {
    const url = new URL(
      authorizeUrl({
        clientId: "client",
        redirectUri: "https://localhost:3443/api/fanvue/callback",
        state: "etat",
        codeChallenge: "defi",
      }),
    );

    // PKCE est obligatoire côté Fanvue: sans `code_challenge_method=S256`,
    // l'autorisation est refusée (4.3.2).
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("etat");
    expect(url.searchParams.get("scope")).toContain("write:post");
  });
});
