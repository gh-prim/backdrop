/**
 * Double local de l'API Graph d'Instagram.
 *
 * Reproduit le flux en trois temps de 4.1.3 avec sa vraie mécanique: le
 * container passe par IN_PROGRESS avant FINISHED, et le serveur **va
 * réellement chercher `image_url`**, comme Meta le fait au moment de la
 * publication (4.1.6). Un Variant qui n'est pas publiquement joignable échoue
 * donc ici exactement comme il échouerait en production.
 *
 * Sert à finir la phase 1 sans compte Instagram: tout est exercé sauf le
 * dernier saut vers les serveurs de Meta.
 *
 *   pnpm tsx scripts/dev-graph-stub.ts
 *   GET http://localhost:9200/_state   pour inspecter ce qui a été publié
 */
import "dotenv/config";
import { createServer } from "node:http";

const PORT = Number(process.env.GRAPH_STUB_PORT ?? 9200);
/** Nombre de sondages renvoyant IN_PROGRESS avant FINISHED. */
const IN_PROGRESS_POLLS = Number(process.env.GRAPH_STUB_POLLS ?? 2);

type Container = {
  id: string;
  params: Record<string, string>;
  polls: number;
  failed?: string;
};

const containers = new Map<string, Container>();
const published: { mediaId: string; creationId: string; params: Record<string, string> }[] = [];
let quotaUsage = 0;
let counter = 0;

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function graphError(res: import("node:http").ServerResponse, code: number, message: string) {
  json(res, 400, { error: { code, message, type: "OAuthException", fbtrace_id: "stub" } });
}

/** Meta fait un cURL sur l'URL: on fait pareil, sinon le double ment. */
async function fetchable(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return `HTTP ${response.status}`;
    await response.arrayBuffer();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const segments = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/_state") {
    return json(res, 200, {
      published,
      quotaUsage,
      containers: [...containers.values()].map(({ id, params, failed }) => ({
        id,
        failed,
        mediaType: params.media_type,
        isCarouselItem: params.is_carousel_item,
        caption: params.caption,
        children: params.children,
      })),
    });
  }

  if (url.pathname === "/_reset") {
    containers.clear();
    published.length = 0;
    quotaUsage = 0;
    return json(res, 200, { ok: true });
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams) params[key] = value;
  for (const [key, value] of new URLSearchParams(body)) params[key] = value;

  if (!params.access_token) return graphError(res, 190, "Invalid OAuth access token.");

  // /{version}/{...}
  const path = segments.slice(1);

  if (path[0] === "oauth" && path[1] === "access_token") {
    return json(res, 200, {
      access_token: `refreshed-${Date.now()}`,
      token_type: "bearer",
      expires_in: 5_184_000,
    });
  }

  if (path[1] === "content_publishing_limit") {
    return json(res, 200, {
      data: [{ quota_usage: quotaUsage, config: { quota_total: 50, quota_duration: 86400 } }],
    });
  }

  if (path[1] === "media" && req.method === "POST") {
    const id = `stub-container-${++counter}`;
    const container: Container = { id, params, polls: 0 };

    const mediaUrl = params.image_url ?? params.video_url;
    if (mediaUrl) {
      const failure = await fetchable(mediaUrl);
      // Un fichier injoignable donne un container ERROR, pas un refus immédiat:
      // c'est le comportement réel, et c'est pour ça que le polling existe.
      if (failure) container.failed = `Media could not be fetched: ${failure}`;
    }

    if (params.media_type === "CAROUSEL") {
      const children = (params.children ?? "").split(",").filter(Boolean);
      if (children.length === 0) return graphError(res, 100, "children is required");
      if (children.length > 10) return graphError(res, 100, "Too many children");
      for (const child of children) {
        if (!containers.has(child)) return graphError(res, 100, `Unknown child ${child}`);
      }
    }

    containers.set(id, container);
    return json(res, 200, { id });
  }

  if (path[1] === "media_publish" && req.method === "POST") {
    const container = containers.get(params.creation_id ?? "");
    if (!container) return graphError(res, 100, "Unknown creation_id");
    if (container.failed) return graphError(res, 100, "Container is in ERROR state");
    if (quotaUsage >= 50) return graphError(res, 9, "Publishing limit reached");

    quotaUsage += 1;
    const mediaId = `1799${String(Date.now()).slice(-13)}`;
    published.push({ mediaId, creationId: container.id, params: container.params });
    return json(res, 200, { id: mediaId });
  }

  // GET /{id}?fields=status_code -> polling d'un container
  const container = containers.get(path[0] ?? "");
  if (container) {
    if (container.failed) {
      return json(res, 200, { status_code: "ERROR", status: container.failed });
    }
    container.polls += 1;
    const done = container.polls > IN_PROGRESS_POLLS;
    return json(res, 200, {
      status_code: done ? "FINISHED" : "IN_PROGRESS",
      status: done ? "Finished" : "In progress",
    });
  }

  // GET /{media-id}?fields=... -> métriques
  const media = published.find((entry) => entry.mediaId === path[0]);
  if (media) {
    return json(res, 200, {
      id: media.mediaId,
      like_count: 42,
      comments_count: 3,
      media_product_type: media.params.media_type === "REELS" ? "REELS" : "FEED",
      permalink: `https://www.instagram.com/p/${media.mediaId}/`,
      timestamp: new Date().toISOString(),
    });
  }

  return graphError(res, 100, `Unsupported object ${url.pathname}`);
});

server.listen(PORT, () => {
  console.log(`double Graph API en écoute sur http://localhost:${PORT}`);
  console.log(`  état: http://localhost:${PORT}/_state`);
});
