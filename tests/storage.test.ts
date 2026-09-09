import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { objectStorageClient } from "@/lib/storage";

/**
 * Régression: Docker Compose transmet une variable non définie comme chaîne
 * vide. Le client doit donc traiter `R2_ENDPOINT=""` comme une absence de
 * surcharge, et non comme un endpoint valide.
 *
 * Le symptôme était muet: les Variants s'ingéraient sans erreur, sans clé R2,
 * et l'échec n'apparaissait qu'à la publication.
 */
describe("client de stockage objet", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.R2_ACCOUNT_ID = "abc123";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    delete process.env.R2_ENDPOINT;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("se construit sans surcharge d'endpoint", () => {
    expect(objectStorageClient()).not.toBeNull();
  });

  it("se construit malgré une surcharge d'endpoint vide", () => {
    process.env.R2_ENDPOINT = "";
    expect(objectStorageClient()).not.toBeNull();
  });

  it("se construit malgré une surcharge faite d'espaces", () => {
    process.env.R2_ENDPOINT = "   ";
    expect(objectStorageClient()).not.toBeNull();
  });

  it("ne se construit pas sans identifiants", () => {
    delete process.env.R2_ACCESS_KEY_ID;
    expect(objectStorageClient()).toBeNull();
  });

  it("ne se construit pas sans compte ni endpoint", () => {
    delete process.env.R2_ACCOUNT_ID;
    expect(objectStorageClient()).toBeNull();
  });
});

describe("lecture d'environnement", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("traite la chaîne vide comme une absence", async () => {
    const { envOr, envOrNull, envNumberOr } = await import("@/lib/env");
    process.env.BACKDROP_TEST_VALUE = "";
    expect(envOr("BACKDROP_TEST_VALUE", "défaut")).toBe("défaut");
    expect(envOrNull("BACKDROP_TEST_VALUE")).toBeNull();
    expect(envNumberOr("BACKDROP_TEST_VALUE", 45)).toBe(45);
  });

  it("traite les espaces seuls comme une absence", async () => {
    const { envOr } = await import("@/lib/env");
    process.env.BACKDROP_TEST_VALUE = "   ";
    expect(envOr("BACKDROP_TEST_VALUE", "défaut")).toBe("défaut");
  });

  it("rend la valeur quand elle est renseignée", async () => {
    const { envOr, envNumberOr } = await import("@/lib/env");
    process.env.BACKDROP_TEST_VALUE = " voilà ";
    expect(envOr("BACKDROP_TEST_VALUE", "défaut")).toBe("voilà");
    process.env.BACKDROP_TEST_NUMBER = "12";
    expect(envNumberOr("BACKDROP_TEST_NUMBER", 45)).toBe(12);
  });

  it("retombe sur le défaut quand le nombre est illisible", async () => {
    const { envNumberOr } = await import("@/lib/env");
    process.env.BACKDROP_TEST_NUMBER = "quarante-cinq";
    expect(envNumberOr("BACKDROP_TEST_NUMBER", 45)).toBe(45);
  });
});
