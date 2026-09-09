import { describe, it, expect } from "vitest";
import {
  InstagramAdapter,
  type GraphFetch,
  type InstagramCredentials,
} from "@/lib/channels/instagram";
import { ChannelError } from "@/lib/channels/types";

/**
 * L'adapter parle au vrai Graph en production, jamais en test. Le double
 * enregistre chaque appel: c'est ce qui permet de vérifier les règles de 4.1.4
 * (légende sur le parent, pas sur les enfants) sans compte Instagram.
 */
type Call = { url: string; method: string; params: Record<string, string> };

function fakeGraph(responses: unknown[], status = 200) {
  const calls: Call[] = [];
  let index = 0;

  const http: GraphFetch = async (url, init) => {
    const parsed = new URL(url);
    const params: Record<string, string> = {};
    for (const [key, value] of parsed.searchParams) params[key] = value;
    if (init?.body) for (const [key, value] of init.body) params[key] = String(value);

    calls.push({ url: parsed.pathname, method: init?.method ?? "GET", params });
    const body = responses[Math.min(index++, responses.length - 1)];
    return { ok: status < 400, status, json: async () => body };
  };

  return { http, calls };
}

const credentials: InstagramCredentials = {
  igUserId: "17841400000000000",
  accessToken: "EAA-token-de-test-suffisamment-long",
};

describe("adapter Instagram", () => {
  it("déclare des capacités qui interdisent le NSFW", () => {
    const { http } = fakeGraph([{}]);
    const capabilities = new InstagramAdapter(credentials, http).capabilities();

    expect(capabilities.maxRating).toBe("SFW");
    expect(capabilities.maxItems).toBe(10);
    expect(capabilities.requiresPublicUrl).toBe(true);
    // L'horloge est tenue par l'application, sur tous les canaux (7.6).
    expect(capabilities.nativeScheduling).toBe(false);
  });

  it("crée un container image avec sa légende", async () => {
    const { http, calls } = fakeGraph([{ id: "container-1" }]);
    const adapter = new InstagramAdapter(credentials, http);

    const id = await adapter.createContainer({
      type: "IMAGE",
      imageUrl: "https://cdn.test/photo.jpg",
      caption: "bonjour",
    });

    expect(id).toBe("container-1");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].params.image_url).toBe("https://cdn.test/photo.jpg");
    expect(calls[0].params.caption).toBe("bonjour");
  });

  it("porte la légende sur le container parent du carrousel, jamais sur les enfants", async () => {
    const { http, calls } = fakeGraph([
      { id: "child-1" },
      { id: "child-2" },
      { id: "parent-1" },
    ]);
    const adapter = new InstagramAdapter(credentials, http);

    await adapter.createContainer({
      type: "CAROUSEL_ITEM_IMAGE",
      imageUrl: "https://cdn.test/1.jpg",
    });
    await adapter.createContainer({
      type: "CAROUSEL_ITEM_IMAGE",
      imageUrl: "https://cdn.test/2.jpg",
    });
    const parent = await adapter.createContainer({
      type: "CAROUSEL",
      children: ["child-1", "child-2"],
      caption: "la légende",
    });

    expect(parent).toBe("parent-1");
    expect(calls[0].params.is_carousel_item).toBe("true");
    expect(calls[0].params.caption).toBeUndefined();
    expect(calls[1].params.caption).toBeUndefined();
    expect(calls[2].params.media_type).toBe("CAROUSEL");
    expect(calls[2].params.children).toBe("child-1,child-2");
    expect(calls[2].params.caption).toBe("la légende");
  });

  it("déclare systématiquement le contenu comme généré par IA", async () => {
    const { http, calls } = fakeGraph([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    const adapter = new InstagramAdapter(credentials, http);

    await adapter.createContainer({ type: "IMAGE", imageUrl: "https://cdn.test/1.jpg" });
    await adapter.createContainer({
      type: "REELS",
      videoUrl: "https://cdn.test/r.mp4",
    });
    await adapter.createContainer({
      type: "CAROUSEL",
      children: ["a", "b"],
      caption: "légende",
    });

    // Toutes les personas sont générées: l'auto-déclaration n'est pas une
    // option qu'un opérateur pourrait oublier de cocher.
    for (const call of calls) {
      expect(call.params.is_ai_generated).toBe("true");
    }
  });

  it("ne pose pas l'étiquette IA sur les enfants d'un carrousel", async () => {
    const { http, calls } = fakeGraph([{ id: "child-1" }]);
    const adapter = new InstagramAdapter(credentials, http);

    await adapter.createContainer({
      type: "CAROUSEL_ITEM_IMAGE",
      imageUrl: "https://cdn.test/1.jpg",
    });

    // Le paramètre n'y est pas accepté: l'étiquette appartient au parent.
    expect(calls[0].params.is_ai_generated).toBeUndefined();
  });

  it("configure l'audio d'un Reel, et seulement d'un Reel", async () => {
    const { http, calls } = fakeGraph([{ id: "reel-1" }]);
    const adapter = new InstagramAdapter(credentials, http);

    await adapter.createContainer({
      type: "REELS",
      videoUrl: "https://cdn.test/reel.mp4",
      caption: "clip",
      audioId: "audio-42",
    });

    expect(calls[0].params.media_type).toBe("REELS");
    expect(JSON.parse(calls[0].params.audio_configuration)).toMatchObject({
      audio_id: "audio-42",
    });
  });

  it("lit le quota annoncé par Meta plutôt qu'une constante", async () => {
    const { http } = fakeGraph([
      { data: [{ quota_usage: 12, config: { quota_total: 50 } }] },
    ]);
    const quota = await new InstagramAdapter(credentials, http).checkQuota();

    expect(quota).toEqual({ used: 12, limit: 50, remaining: 38 });
  });

  it("classe l'erreur 9 (quota atteint) comme non réessayable", async () => {
    const { http } = fakeGraph(
      [{ error: { code: 9, message: "The user is not allowed to publish" } }],
      400,
    );
    const adapter = new InstagramAdapter(credentials, http);

    await expect(
      adapter.createContainer({ type: "IMAGE", imageUrl: "https://cdn.test/x.jpg" }),
    ).rejects.toMatchObject({ retryable: false, code: "graph_9" });
  });

  it("classe une limite de débit comme réessayable", async () => {
    const { http } = fakeGraph(
      [{ error: { code: 4, message: "Application request limit reached" } }],
      400,
    );
    const adapter = new InstagramAdapter(credentials, http);

    await expect(
      adapter.createContainer({ type: "IMAGE", imageUrl: "https://cdn.test/x.jpg" }),
    ).rejects.toMatchObject({ retryable: true, code: "graph_4" });
  });

  it("classe un token invalide comme non réessayable", async () => {
    const { http } = fakeGraph([{ error: { code: 190, message: "Invalid OAuth token" } }], 400);
    const adapter = new InstagramAdapter(credentials, http);

    await expect(adapter.checkQuota()).rejects.toMatchObject({
      retryable: false,
      code: "graph_190",
    });
  });

  it("réessaye sur une panne serveur", async () => {
    const { http } = fakeGraph([{}], 503);
    const adapter = new InstagramAdapter(credentials, http);

    const error = await adapter.checkQuota().catch((e) => e);
    expect(error).toBeInstanceOf(ChannelError);
    expect(error.retryable).toBe(true);
  });

  it("remonte le status_code du container", async () => {
    const { http } = fakeGraph([{ status_code: "FINISHED" }]);
    const adapter = new InstagramAdapter(credentials, http);

    expect(await adapter.getContainerStatus("c-1")).toMatchObject({ status: "FINISHED" });
  });

  it("échange le long-lived token et calcule son expiration", async () => {
    const { http, calls } = fakeGraph([
      { access_token: "nouveau-token", expires_in: 5_184_000 },
    ]);
    const adapter = new InstagramAdapter(credentials, http);

    const result = await adapter.refreshLongLivedToken();

    expect(result.accessToken).toBe("nouveau-token");
    expect(calls[0].params.grant_type).toBe("fb_exchange_token");
    const days = (result.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(60);
  });

  it("distingue un Reel publié par son media_product_type", async () => {
    const { http } = fakeGraph([
      { id: "m1", like_count: 3, media_product_type: "REELS", permalink: "https://ig/p/1" },
    ]);
    const metrics = await new InstagramAdapter(credentials, http).fetchMetrics("m1");

    // REELS n'est pas un vrai media type: après publication l'API renvoie
    // VIDEO, c'est media_product_type qui tranche (4.1.4).
    expect(metrics.mediaProductType).toBe("REELS");
    expect(metrics.likeCount).toBe(3);
  });
});
