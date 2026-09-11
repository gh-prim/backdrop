import { requireOrgContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { subscribeToInbox } from "@/lib/inbox-events";

/**
 * Le flux d'événements de l'inbox (SSE).
 *
 * Une connexion ouverte par onglet, et rien ne transite tant que rien
 * n'arrive. Le contenu du message n'y passe **pas**: l'événement dit
 * seulement qu'un fil a bougé, et le navigateur redemande la page. Faire
 * voyager le texte ici obligerait à refaire le contrôle d'accès sur ce canal,
 * alors qu'il est déjà tenu par le rendu de la page.
 */
export const dynamic = "force-dynamic";

/**
 * Un commentaire SSE toutes les 25 secondes. Les proxies coupent une
 * connexion silencieuse — Caddy comme n'importe quel autre — et le flux
 * mourrait sans que personne ne s'en aperçoive.
 */
const KEEPALIVE_MS = 25_000;

export async function GET(request: Request) {
  const ctx = await requireOrgContext();

  // Les personas de l'organisation, lues une fois: l'événement ne porte qu'un
  // identifiant de persona, et il ne doit réveiller que les siens (9.6).
  const personas = await prisma.persona.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true },
  });
  const mine = new Set(personas.map((persona) => persona.id));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      function push(line: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          closed = true;
        }
      }

      push(": connected\n\n");

      const unsubscribe = subscribeToInbox((event) => {
        if (!mine.has(event.personaId)) return;
        push(`data: ${JSON.stringify({ conversationId: event.conversationId })}\n\n`);
      });

      const keepalive = setInterval(() => push(": keepalive\n\n"), KEEPALIVE_MS);

      function stop() {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Déjà fermé par le client: rien à faire.
        }
      }

      request.signal.addEventListener("abort", stop);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Caddy ne tamponne pas, mais un proxy intermédiaire le ferait: sans
      // cet en-tête, les événements arriveraient par paquets de plusieurs
      // kilo-octets, c'est-à-dire jamais sur un flux aussi léger.
      "X-Accel-Buffering": "no",
    },
  });
}
