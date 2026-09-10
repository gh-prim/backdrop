import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { exportConfig } from "../src/lib/config-backup";

/**
 * Export de configuration en ligne de commande.
 *
 * Même fonction que Réglages → Backup, pour les cas où l'interface n'est pas
 * atteignable. La phrase de passe n'est pas mémorisée: sans elle, le fichier
 * ne vaut rien.
 *
 *   pnpm tsx scripts/config-export.ts <phrase de passe> <fichier>
 */
async function main() {
  const [passphrase, out] = process.argv.slice(2);
  if (!passphrase || !out) {
    throw new Error("usage: config-export.ts <phrase de passe> <fichier.json>");
  }

  const organization = await prisma.organization.findFirstOrThrow({
    select: { id: true, name: true },
  });

  const backup = await exportConfig(
    {
      organizationId: organization.id,
      userId: "script",
      userName: "script",
      userEmail: "script@backdrop.local",
      role: "owner",
    },
    { passphrase },
  );

  writeFileSync(out, JSON.stringify(backup, null, 2));
  const channels = backup.personas.reduce((n, p) => n + p.channels.length, 0);
  console.log(
    `${out}: ${backup.personas.length} persona(s), ${channels} canal/canaux, identifiants scellés.`,
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("export:", error.message);
  await prisma.$disconnect();
  process.exit(1);
});
