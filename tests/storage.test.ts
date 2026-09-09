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
