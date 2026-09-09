import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Chiffrement des credentials plateforme au repos (spec 9.2).
 *
 * Clé maître en variable d'environnement, jamais en base, jamais dans le dépôt.
 * AES-256-GCM: le tag d'authentification rend toute altération du chiffré
 * détectable, ce qui compte pour des jetons dont dépend l'accès à des comptes
 * réels.
 *
 * Format stocké: iv (12) | tag (16) | chiffré (n).
 *
 * Pas de `server-only` ici, à la différence des autres modules sensibles: ce
 * fichier est aussi importé par le worker, qui est un process Node ordinaire.
 * La garantie est reprise par un test structurel (tests/module-boundaries),
 * qui échoue si un composant client atteint ce module.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.CREDENTIALS_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIALS_MASTER_KEY manquante. Générer avec: openssl rand -base64 32",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIALS_MASTER_KEY invalide: ${key.length} octets décodés, ${KEY_BYTES} attendus.`,
    );
  }

  cachedKey = key;
  return key;
}

/** Réinitialise la clé mémorisée. Réservé aux tests. */
export function resetMasterKeyCache() {
  cachedKey = null;
}

export function encryptCredentials(payload: unknown): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // Uint8Array et non Buffer: c'est ce que Prisma attend pour une colonne Bytes,
  // et les deux types ont divergé côté @types/node.
  const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  const out = new Uint8Array(new ArrayBuffer(packed.length));
  out.set(packed);
  return out;
}

export function decryptCredentials<T>(blob: Buffer | Uint8Array): T {
  const buffer = Buffer.from(blob);
  if (buffer.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Credentials illisibles: contenu trop court.");
  }

  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = buffer.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

/** Comparaison à temps constant, pour les secrets courts comparés en clair. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
