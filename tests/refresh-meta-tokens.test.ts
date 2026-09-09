import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Platform, Rating } from "@prisma/client";
import {
  prisma,
  resetDatabase,
  createOrganization,
  createPersona,
} from "./helpers";
import {
  InstagramAdapter,
  type GraphFetch,
  type InstagramCredentials,
} from "@/lib/channels/instagram";
import {
  encryptCredentials,
  decryptCredentials,
  resetMasterKeyCache,
} from "@/lib/crypto";

/**
 * Rafraîchissement des tokens Meta (4.1.9).
 *
 * Le mode de panne à empêcher n'est pas bruyant: sans refresh, tout continue
 * de fonctionner pendant 60 jours puis s'arrête sans explication.
 */
describe("refresh du long-lived token Meta", () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMasterKeyCache();
    process.env.CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.META_APP_ID = "app-id";
    process.env.META_APP_SECRET = "app-secret";
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function graphReturning(body: unknown): GraphFetch {
    return async () => ({ ok: true, status: 200, json: async () => body });
  }

  it("remplace le token stocké et repousse la date d'expiration", async () => {
    const org = await createOrganization();
    const persona = await createPersona(org.id);

    const expiringSoon = new Date(Date.now() + 2 * 86_400_000);
    const channel = await prisma.channelAccount.create({
      data: {
        personaId: persona.id,
        platform: Platform.INSTAGRAM,
        externalId: "1784",
        credentials: encryptCredentials({
          igUserId: "1784",
          accessToken: "ancien-token",
        }),
        maxRating: Rating.SFW,
        tokenExpiresAt: expiringSoon,
      },
    });

    // On rejoue ce que fait l'activité, sans dépendre du réseau.
    const stored = decryptCredentials<InstagramCredentials>(
      (await prisma.channelAccount.findUniqueOrThrow({ where: { id: channel.id } }))
        .credentials,
    );
    const adapter = new InstagramAdapter(
      stored,
      graphReturning({ access_token: "token-frais", expires_in: 5_184_000 }),
    );
    const { accessToken, expiresAt } = await adapter.refreshLongLivedToken();

    await prisma.channelAccount.update({
      where: { id: channel.id },
      data: {
        credentials: encryptCredentials({ ...stored, accessToken }),
        tokenExpiresAt: expiresAt,
      },
    });

    const after = await prisma.channelAccount.findUniqueOrThrow({
      where: { id: channel.id },
    });
    const refreshed = decryptCredentials<InstagramCredentials>(after.credentials);

    expect(refreshed.accessToken).toBe("token-frais");
    expect(refreshed.igUserId).toBe("1784");
    expect(after.tokenExpiresAt!.getTime()).toBeGreaterThan(expiringSoon.getTime());
  });

  it("laisse le token en base intact si l'échange échoue", async () => {
    const org = await createOrganization();
    const persona = await createPersona(org.id);
    const channel = await prisma.channelAccount.create({
      data: {
        personaId: persona.id,
        platform: Platform.INSTAGRAM,
        externalId: "1785",
        credentials: encryptCredentials({ igUserId: "1785", accessToken: "toujours-la" }),
        maxRating: Rating.SFW,
      },
    });

    const adapter = new InstagramAdapter(
      { igUserId: "1785", accessToken: "toujours-la" },
      async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 190, message: "Invalid OAuth token" } }),
      }),
    );

    await expect(adapter.refreshLongLivedToken()).rejects.toMatchObject({
      retryable: false,
    });

    const after = await prisma.channelAccount.findUniqueOrThrow({
      where: { id: channel.id },
    });
    expect(
      decryptCredentials<InstagramCredentials>(after.credentials).accessToken,
    ).toBe("toujours-la");
  });

  it("l'état de connexion se lit sans jamais toucher aux credentials", async () => {
    const { connectionState } = await import("@/lib/channels");
    const now = new Date("2026-01-01T00:00:00Z");

    expect(connectionState(new Date("2026-03-01T00:00:00Z"), now)).toMatchObject({
      state: "connected",
    });
    expect(connectionState(new Date("2026-01-04T00:00:00Z"), now)).toMatchObject({
      state: "expiring",
    });
    expect(connectionState(new Date("2025-12-30T00:00:00Z"), now)).toMatchObject({
      state: "expired",
    });
    expect(connectionState(null, now)).toMatchObject({ state: "unknown" });
  });
});
