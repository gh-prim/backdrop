import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptCredentials,
  decryptCredentials,
  resetMasterKeyCache,
} from "@/lib/crypto";

/**
 * Spec 9.2: credentials chiffrés au repos, clé maître en variable
 * d'environnement, jamais en base.
 */
describe("chiffrement des credentials", () => {
  beforeEach(() => {
    resetMasterKeyCache();
    process.env.CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("chiffre puis déchiffre sans perte", () => {
    const secret = { igUserId: "1784", accessToken: "EAA-secret" };
    const blob = encryptCredentials(secret);

    expect(decryptCredentials(blob)).toEqual(secret);
  });

  it("ne laisse pas le secret lisible dans le chiffré", () => {
    const blob = encryptCredentials({ accessToken: "EAA-tres-secret" });
    expect(Buffer.from(blob).toString("utf8")).not.toContain("EAA-tres-secret");
    expect(Buffer.from(blob).toString("base64")).not.toContain("EAA-tres-secret");
  });

  it("produit un chiffré différent à chaque appel, à secret identique", () => {
    const a = encryptCredentials({ accessToken: "identique" });
    const b = encryptCredentials({ accessToken: "identique" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("détecte l'altération du chiffré", () => {
    const blob = Buffer.from(encryptCredentials({ accessToken: "EAA" }));
    blob[blob.length - 1] ^= 0xff;

    // GCM authentifie: un octet modifié ne donne pas un déchiffrement erroné,
    // il donne une erreur.
    expect(() => decryptCredentials(blob)).toThrow();
  });

  it("refuse de déchiffrer avec une autre clé", () => {
    const blob = encryptCredentials({ accessToken: "EAA" });

    resetMasterKeyCache();
    process.env.CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");

    expect(() => decryptCredentials(blob)).toThrow();
  });

  it("refuse une clé maître de mauvaise taille", () => {
    resetMasterKeyCache();
    process.env.CREDENTIALS_MASTER_KEY = Buffer.alloc(16, 1).toString("base64");

    expect(() => encryptCredentials({})).toThrow(/32 attendus/);
  });

  it("refuse de fonctionner sans clé maître", () => {
    resetMasterKeyCache();
    delete process.env.CREDENTIALS_MASTER_KEY;

    expect(() => encryptCredentials({})).toThrow(/CREDENTIALS_MASTER_KEY manquante/);
  });
});
