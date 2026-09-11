import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde structurel des frontières de modules.
 *
 * Deux modules sensibles (src/lib/crypto.ts, src/temporal/client.ts) ne
 * peuvent pas porter `server-only`: ils sont aussi importés par le worker et
 * les scripts, qui sont des process Node ordinaires. Ce test reprend la
 * garantie perdue, et l'étend à tous les modules serveur.
 */

const SERVER_ONLY_MODULES = [
  "@/lib/crypto",
  "@/lib/db",
  "@/lib/channels",
  "@/lib/config-backup",
  "@/lib/composer-preselect",
  "@/lib/invitations",
  "@/lib/assets",
  "@/lib/publications",
  "@/lib/inbox",
  "@/lib/persona-scope",
  "@/lib/session",
  "@/temporal/client",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("frontières serveur / client", () => {
  it("aucun composant client n'importe un module serveur", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles("src")) {
      const source = readFileSync(file, "utf8");
      const isClient = /^\s*["']use client["']/m.test(source);
      if (!isClient) continue;

      for (const serverModule of SERVER_ONLY_MODULES) {
        // Les imports de type sont effacés à la compilation: ils ne font pas
        // entrer le module dans le bundle client.
        const runtimeImport = new RegExp(
          `import\\s+(?!type\\s)[^;]*from\\s+["']${serverModule}["']`,
        );
        if (runtimeImport.test(source)) offenders.push(`${file} -> ${serverModule}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("le démarrage d'une publication n'envoie pas de signal de reprogrammation", () => {
    // Régression: `signalWithStart` avec le signal de reprogrammation portait
    // l'heure courante, qui écrasait l'échéance lue en base au démarrage du
    // workflow. Résultat: toute publication programmée partait immédiatement.
    // Le démarrage et la reprogrammation sont deux gestes distincts (7.6).
    const source = readFileSync("src/temporal/client.ts", "utf8");
    // On cible l'appel, pas la mention: le commentaire qui explique l'erreur
    // a le droit de nommer la méthode fautive.
    expect(source).not.toMatch(/\.signalWithStart\s*\(/);
  });

  it("le code de workflow ne lit jamais l'environnement", () => {
    // La sandbox Temporal n'a pas `process`: un accès à l'environnement fait
    // échouer l'activation du workflow, pas la compilation.
    const offenders: string[] = [];

    for (const file of sourceFiles("worker/workflows")) {
      if (/process\.env/.test(readFileSync(file, "utf8"))) offenders.push(file);
    }

    // Et les modules qu'ils importent depuis src/temporal.
    if (/process\.env/.test(readFileSync("src/temporal/config.ts", "utf8"))) {
      offenders.push("src/temporal/config.ts");
    }

    expect(offenders).toEqual([]);
  });
});
