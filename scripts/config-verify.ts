import "dotenv/config";
import { readFileSync } from "node:fs";
import { openWithPassphrase } from "../src/lib/crypto";

/**
 * Relit un export sans rien importer.
 *
 * Sert à vérifier qu'un fichier s'ouvrira bien sur la machine de destination
 * — la mauvaise surprise se découvre autrement au moment de provisionner.
 *
 *   pnpm tsx scripts/config-verify.ts <fichier.json> <phrase de passe>
 */
const [file, passphrase] = process.argv.slice(2);
const backup = JSON.parse(readFileSync(file, "utf8"));

if (!backup.secrets) {
  console.log("Fichier sans identifiants: rien à ouvrir.");
  process.exit(0);
}

const secrets = openWithPassphrase<{
  channels: Record<string, unknown>;
  telegramApps: Record<string, unknown>;
}>(backup.secrets, passphrase);

console.log(
  `coffre ouvert: ${Object.keys(secrets.channels).length} canal/canaux, ` +
    `${Object.keys(secrets.telegramApps).length} app Telegram`,
);
// Les clés seulement, jamais les valeurs.
for (const key of Object.keys(secrets.channels)) console.log("  ", key);
