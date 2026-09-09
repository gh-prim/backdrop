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

  // Garde structurel: seule la couche autorisée peut lire la colonne.
  it("aucun composant ni route ne sélectionne la colonne credentials", () => {
    const allowed = new Set([
      join("src", "lib", "channels.ts"), // ne fait que documenter son absence
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

    expect(offenders).toEqual([]);
  });
});
