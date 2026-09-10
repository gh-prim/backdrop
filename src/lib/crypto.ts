import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
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


/**
 * Chiffrement sous une phrase de passe choisie par l'opérateur.
 *
 * Sert à la sauvegarde de configuration: la clé maître appartient à
 * l'instance, donc un fichier chiffré avec elle serait illisible sur celle
 * qu'on veut provisionner. La phrase de passe voyage dans la tête de
 * l'opérateur, jamais dans le fichier.
 *
 * scrypt et non un hachage simple: une phrase de passe humaine a peu
 * d'entropie, et le coût mémoire de scrypt est ce qui rend l'essai en masse
 * déraisonnable si le fichier fuit.
 */
const SCRYPT_COST = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SALT_BYTES = 16;

export type SealedBox = {
  algorithm: "aes-256-gcm";
  kdf: "scrypt";
  /** Base64. */
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export function sealWithPassphrase(payload: unknown, passphrase: string): SealedBox {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(passphrase.normalize("NFKC"), salt, KEY_BYTES, SCRYPT_COST);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);

  return {
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

/** Lève si la phrase de passe est fausse ou le contenu altéré (tag GCM). */
export function openWithPassphrase<T>(box: SealedBox, passphrase: string): T {
  const salt = Buffer.from(box.salt, "base64");
  const key = scryptSync(passphrase.normalize("NFKC"), salt, KEY_BYTES, SCRYPT_COST);

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(box.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
