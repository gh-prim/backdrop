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

describe("confirmation d'un envoi", () => {
  const SHELL = readFileSync("src/app/(app)/inbox/inbox-shell.tsx", "utf8");

  it("l'écran redemande la page tant qu'un message est en attente", () => {
    // `router.refresh()` au retour de l'action arrive avant le worker: sans
    // ce suivi, un message parti restait affiché « sending… » pour toujours.
    expect(SHELL).toContain('message.status === "PENDING"');
    expect(SHELL).toMatch(/setInterval\([\s\S]{0,200}router\.refresh\(\)/);
  });

  it("et s'arrête au bout d'un temps borné", () => {
    // Un worker à l'arrêt ne doit pas faire interroger le serveur jusqu'au
    // soir par un onglet resté ouvert.
    expect(SHELL).toMatch(/clearInterval/);
    expect(SHELL).toContain("PENDING_POLLS");
  });
});

describe("garde-fous du disque", () => {
  const COMPOSE = readFileSync("docker-compose.yml", "utf8");
  const UPDATE = readFileSync("scripts/update.sh", "utf8");

  it("chaque service plafonne son journal", () => {
    // `json-file` ne tourne pas ses fichiers par défaut: le journal d'un
    // conteneur allumé en permanence grandit jusqu'à remplir le disque, et il
    // ne figure dans aucune colonne de `docker system df`.
    // Le bloc `services:` seul: l'ancre et les volumes ne sont pas des
    // services et n'ont rien à plafonner.
    const block = COMPOSE.slice(
      COMPOSE.indexOf("\nservices:"),
      COMPOSE.indexOf("\nvolumes:"),
    );
    const services = [...block.matchAll(/^ {2}([a-z][a-z-]*):$/gm)].map((m) => m[1]);
    const capped = [...block.matchAll(/<<: \*logs/g)];
    expect(services.length).toBeGreaterThan(5);
    expect(capped).toHaveLength(services.length);
  });

  it("déploie en tirant les images, pas en les construisant", () => {
    // Le serveur a 3 Go de mémoire: un `next build` et deux installations
    // pnpm y prenaient une vingtaine de minutes à échanger de la mémoire.
    expect(UPDATE).toContain("docker compose pull");
    expect(UPDATE).toContain("--build");
  });

  it("échoue si les images ne sont pas disponibles", () => {
    // Sans cela on redéploierait l'image précédente en croyant avoir déployé
    // la nouvelle — exactement ce que la vérification de version existe pour
    // empêcher.
    expect(UPDATE).toMatch(/Images indisponibles[\s\S]{0,300}exit 1/);
  });
});

describe("images Docker", () => {
  const WORKER = readFileSync("Dockerfile.worker", "utf8");
  const WEB = readFileSync("Dockerfile.web", "utf8");
  const COMPOSE = readFileSync("docker-compose.yml", "utf8");

  it("migrations et worker descendent de la même étape", () => {
    // Deux Dockerfile distincts donnaient deux node_modules complets sans une
    // couche en commun: 2,6 Go d'un côté, 1,7 Go de l'autre, pour les mêmes
    // paquets. Mesuré après: 13 couches sur 13 partagées.
    expect(WORKER).toContain("FROM deps AS migrate");
    expect(WORKER).toContain("FROM deps AS worker");
    expect(WEB).not.toContain("AS migrate");
  });

  it("les migrations ne portent pas ffmpeg", () => {
    // 150 Mo de codecs pour appliquer un schéma: l'installation vient après
    // la séparation des cibles, pas avant.
    const split = WORKER.indexOf("FROM deps AS migrate");
    const ffmpeg = WORKER.indexOf("ffmpeg \\");
    expect(ffmpeg).toBeGreaterThan(split);
  });

  it("les services pointent la bonne cible", () => {
    // Sans `target`, Docker construit la **dernière** étape du fichier: le
    // service migrate deviendrait un worker, silencieusement.
    const targets = [...COMPOSE.matchAll(/dockerfile: Dockerfile\.worker\n\s*target: (\w+)/g)];
    expect(targets.map((m) => m[1]).sort()).toEqual(["migrate", "migrate", "worker"]);
  });
});

describe("construction sur GitHub", () => {
  const WORKFLOW = readFileSync(".github/workflows/images.yml", "utf8");
  const COMPOSE = readFileSync("docker-compose.yml", "utf8");

  it("construit toutes les images dont le compose a besoin", () => {
    // Une image oubliée ici, et le serveur tirerait indéfiniment une version
    // qui ne sort jamais.
    const needed = [...COMPOSE.matchAll(/image: ghcr\.io\/gh-prim\/backdrop\/([\w-]+):/g)];
    const built = [...WORKFLOW.matchAll(/- name: ([\w-]+)\n\s+context:/g)].map((m) => m[1]);
    for (const [, name] of needed) {
      expect(built, `image ${name} absente du workflow`).toContain(name);
    }
  });

  it("étiquette aussi par commit, pour pouvoir revenir en arrière", () => {
    // `latest` seul interdirait tout retour sans reconstruction.
    expect(WORKFLOW).toContain("${{ github.sha }}");
    expect(COMPOSE).toContain("${IMAGE_TAG:-latest}");
  });

  it("une image qui échoue n'annule pas les autres", () => {
    expect(WORKFLOW).toContain("fail-fast: false");
  });
});
