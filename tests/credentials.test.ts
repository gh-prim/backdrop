import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Platform, Rating } from "@prisma/client";
import {
  prisma,
  resetDatabase,
  createOrganization,
  createUser,
  createPersona,
  createChannel,
} from "./helpers";

/**
 * Spec 9.7: aucune route ne renvoie de credential plateforme, ni en clair ni
 * tronqué, et le rôle owner n'y change rien.
 */
describe("opacité des credentials plateforme", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it("la projection d'un ChannelAccount ne contient aucun credential", async () => {
    const { listChannelStatus } = await import("@/lib/channels");
    const org = await createOrganization();
    await createUser();
    const persona = await createPersona(org.id);
    await createChannel(persona.id, Platform.INSTAGRAM, Rating.SFW);

    const channels = await listChannelStatus({
      userId: "u",
      userName: "Owner",
      userEmail: "o@test.local",
      organizationId: org.id,
      // Le rôle le plus élevé ne débloque rien.
      role: "owner",
    });

    expect(channels).toHaveLength(1);
    const serialized = JSON.stringify(channels);
    expect(Object.keys(channels[0])).not.toContain("credentials");
    expect(serialized).not.toContain("chiffré-au-repos");
    expect(serialized.toLowerCase()).not.toContain("credential");
  });

  /**
   * Garde structurel: la colonne `credentials` n'est lisible que dans la
   * couche qui parle aux plateformes. Trois fichiers y ont droit, et la liste
   * est volontairement courte: elle est le périmètre à relire quand on touche
   * à la sécurité.
   */
  it("seule la couche adapter lit la colonne credentials", () => {
    const allowed = new Set([
      // Résout les credentials pour construire l'adapter, côté worker.
      join("worker", "activities", "instagram.ts"),
      // Les détient en mémoire le temps d'un appel Graph.
      join("src", "lib", "channels", "instagram.ts"),
      // N'écrit qu'un blob déjà chiffré, ne relit jamais.
      join("src", "app", "actions", "channels.ts"),
      // Documente leur absence de la projection.
      join("src", "lib", "channels.ts"),
    ]);
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (allowed.has(full)) continue;

        const source = readFileSync(full, "utf8");
        // `credentials: true` dans un select Prisma, ou un accès direct.
        if (/credentials\s*:\s*true/.test(source) || /\.credentials\b/.test(source)) {
          offenders.push(full);
        }
      }
    }
    walk("src");
    walk("worker");

    expect(offenders).toEqual([]);
  });
});
