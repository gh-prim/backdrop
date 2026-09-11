import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { APP_VERSION } from "@/lib/version";

/**
 * La version doit être **une**.
 *
 * Elle existe pour distinguer « déployé » de « supposé déployé ». Deux sources
 * qui divergent ne distinguent plus rien: `update.sh` compare ce que sert
 * l'application à ce que dit `package.json`, et si les deux ne parlent pas du
 * même endroit, la vérification devient un rituel sans effet.
 */
describe("version de l'applicatif", () => {
  it("package.json et le code annoncent la même", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(pkg.version).toBe(APP_VERSION);
  });

  it("suit le semver", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("est servie sans authentification, sinon update.sh ne peut pas la lire", () => {
    const route = readFileSync("src/app/api/version/route.ts", "utf8");
    expect(route).not.toContain("requireOrgContext");
    expect(route).toContain("APP_VERSION");
  });

  it("update.sh échoue si l'application ne sert pas la version attendue", () => {
    const script = readFileSync("scripts/update.sh", "utf8");
    expect(script).toContain("/api/version");
    // Depuis l'hôte: l'image web est minimale et n'embarque ni curl ni wget.
    // Une vérification qui suppose ces outils dans le conteneur bloquerait
    // tous les déploiements au lieu d'en signaler un seul.
    expect(script).not.toMatch(/exec -T web (wget|curl)/);
    // Sans ce `exit 1`, le script annoncerait « À jour » sur une image périmée
    // — exactement ce qui est arrivé le 2026-09-11.
    expect(script).toMatch(/Déploiement incomplet[\s\S]{0,400}exit 1/);
  });

  it("est affichée à l'écran, pas seulement servie par une route", () => {
    const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
    expect(layout).toContain("APP_VERSION");
  });
});

describe("pastille de non-lus", () => {
  it("tronque au-delà de dix", async () => {
    const { unreadLabel } = await import("@/lib/unread-shared");
    expect(unreadLabel(0)).toBe("0");
    expect(unreadLabel(9)).toBe("9");
    expect(unreadLabel(10)).toBe("10");
    // Au-delà, le chiffre exact n'apprend plus rien, et la pastille garderait
    // une largeur variable qui ferait sauter la navigation.
    expect(unreadLabel(11)).toBe("10+");
    expect(unreadLabel(4000)).toBe("10+");
  });
});
