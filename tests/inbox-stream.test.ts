import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Le flux d'événements de l'inbox.
 *
 * Deux propriétés se vérifient sans ouvrir de connexion, et ce sont
 * précisément celles qu'on casse sans s'en apercevoir: le cloisonnement par
 * organisation, et le fait qu'une seule connexion Postgres serve tous les
 * onglets.
 */

const ROUTE = readFileSync("src/app/api/inbox/stream/route.ts", "utf8");
const EVENTS = readFileSync("src/lib/inbox-events.ts", "utf8");

describe("flux d'inbox", () => {
  it("n'envoie que les événements de l'organisation de la session", () => {
    // Le canal Postgres est global à l'instance: sans ce filtre, un onglet
    // apprendrait qu'un fil bouge chez quelqu'un d'autre.
    expect(ROUTE).toContain("requireOrgContext");
    expect(ROUTE).toContain("organizationId: ctx.organizationId");
    expect(ROUTE).toMatch(/mine\.has\(event\.personaId\)/);
  });

  it("ne fait pas voyager le contenu des messages", () => {
    // L'événement dit qu'un fil a bougé, rien de plus: le texte passerait
    // alors par un canal dont il faudrait retenir le contrôle d'accès, alors
    // qu'il est déjà tenu par le rendu de la page.
    expect(ROUTE).not.toMatch(/data: \$\{JSON\.stringify\(event\)\}/);
    expect(ROUTE).toContain("conversationId: event.conversationId");
  });

  it("garde le flux en vie malgré les proxies", () => {
    // Une connexion silencieuse se fait couper, et le flux mourrait sans que
    // personne ne s'en aperçoive.
    expect(ROUTE).toContain("keepalive");
    expect(ROUTE).toContain("X-Accel-Buffering");
  });

  it("relâche son abonnement quand le navigateur part", () => {
    expect(ROUTE).toContain("unsubscribe()");
    expect(ROUTE).toContain('request.signal.addEventListener("abort"');
  });

  it("n'ouvre qu'une connexion Postgres pour tout le processus", () => {
    // Un LISTEN par onglet ferait grimper le nombre de connexions avec le
    // nombre d'onglets, et le plafond se découvrirait un jour de forte
    // activité — c'est-à-dire au pire moment.
    expect(EVENTS).toContain("__inboxClient");
    expect(EVENTS).toMatch(/if \(!store\.__inboxClient\) void connect/);
  });

  it("reprend la connexion après une coupure", () => {
    expect(EVENTS).toMatch(/client\.on\("error"/);
    expect(EVENTS).toContain("RETRY_MS");
  });

  it("écoute le canal que le worker notifie", () => {
    const worker = readFileSync(
      "worker-telegram/backdrop_telegram/inbox_store.py",
      "utf8",
    );
    const channel = EVENTS.match(/const CHANNEL = "([^"]+)"/)?.[1];
    expect(channel).toBeTruthy();
    // Deux noms qui divergent donnent un flux parfaitement silencieux, sans
    // la moindre erreur nulle part.
    expect(worker).toContain(`NOTIFY_CHANNEL = "${channel}"`);
  });
});
