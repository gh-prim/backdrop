import { config } from "dotenv";

config({ path: ".env.test", override: true });

/**
 * Clé de test déterministe.
 *
 * `.env.test` n'est pas versionné: sans ce garde-fou, la suite dépendrait d'un
 * fichier que chaque machine écrit à sa façon, et une clé mal formée ferait
 * échouer le chiffrement au repos loin de sa cause. Une clé fixe ici rend les
 * tests reproductibles — et elle ne protège rien de réel, la base de test
 * étant recréée à chaque exécution.
 */
const TEST_KEY = Buffer.from("test-master-key-32-bytes-long!!!").toString("base64");

const provided = process.env.CREDENTIALS_MASTER_KEY;
if (!provided || Buffer.from(provided, "base64").length !== 32) {
  process.env.CREDENTIALS_MASTER_KEY = TEST_KEY;
}
