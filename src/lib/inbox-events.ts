import "server-only";
import { Client } from "pg";
import { envOr } from "@/lib/env";

/**
 * Le fil d'événements de l'inbox.
 *
 * Le worker émet un `pg_notify` après chaque message écrit; l'application
 * l'écoute et réveille les navigateurs ouverts. C'est le choix qui a été fait
 * contre le sondage: un onglet resté ouvert toute la journée coûte zéro
 * requête tant que rien n'arrive, là où un rafraîchissement toutes les cinq
 * secondes en fait 720 par heure et par onglet pour n'apprendre rien.
 *
 * **Une seule connexion pour tout le processus**, et non une par onglet. Un
 * `LISTEN` par navigateur ouvert ferait grimper le nombre de connexions
 * Postgres avec le nombre d'onglets — la base a un plafond, et il se
 * découvrirait un jour de forte activité, c'est-à-dire au pire moment.
 */

export type InboxEvent = {
  personaId: string;
  conversationId: string;
};

const CHANNEL = "backdrop_inbox";

/**
 * Perdre la connexion est normal: redémarrage de Postgres, coupure réseau,
 * conteneur recréé. On la reprend, avec un délai qui évite de marteler une
 * base qui ne répond pas encore.
 */
const RETRY_MS = 2_000;

type Subscriber = (event: InboxEvent) => void;

/**
 * L'état vit sur `globalThis`: en développement, le rechargement à chaud
 * ré-évalue le module et ouvrirait une connexion de plus à chaque édition —
 * le même motif que pour le client Prisma.
 */
const store = globalThis as unknown as {
  __inboxSubscribers?: Set<Subscriber>;
  __inboxClient?: Client | null;
  __inboxStarting?: boolean;
};

const subscribers = (store.__inboxSubscribers ??= new Set<Subscriber>());

function broadcast(payload: string): void {
  let event: InboxEvent;
  try {
    event = JSON.parse(payload) as InboxEvent;
  } catch {
    // Une charge illisible ne doit pas interrompre l'écoute pour tout le
    // monde: on l'ignore et l'on attend la suivante.
    return;
  }

  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      // Un abonné qui échoue — navigateur parti en cours d'écriture — ne doit
      // pas priver les autres de l'événement.
    }
  }
}

async function connect(): Promise<void> {
  if (store.__inboxStarting) return;
  store.__inboxStarting = true;

  const client = new Client({ connectionString: envOr("DATABASE_URL", "") });
  client.on("notification", (message) => {
    if (message.channel === CHANNEL && message.payload) broadcast(message.payload);
  });
  client.on("error", () => {
    // `end()` peut échouer sur une connexion déjà morte: ce qui compte est de
    // relâcher la référence pour qu'une nouvelle soit ouverte.
    store.__inboxClient = null;
    store.__inboxStarting = false;
    void client.end().catch(() => {});
    setTimeout(() => void connect().catch(() => {}), RETRY_MS);
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    store.__inboxClient = client;
  } catch {
    store.__inboxStarting = false;
    setTimeout(() => void connect().catch(() => {}), RETRY_MS);
    return;
  }

  store.__inboxStarting = false;
}

/**
 * S'abonne aux événements, et rend de quoi se désabonner.
 *
 * La connexion s'ouvre au premier abonné et reste ouverte ensuite: la fermer
 * au dernier départ la rouvrirait à chaque navigation, pour un gain nul.
 */
export function subscribeToInbox(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  if (!store.__inboxClient) void connect().catch(() => {});

  return () => {
    subscribers.delete(subscriber);
  };
}
