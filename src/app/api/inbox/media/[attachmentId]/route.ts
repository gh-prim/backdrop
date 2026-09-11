import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/session";
import { envOr } from "@/lib/env";

/**
 * Lecture d'une pièce jointe reçue.
 *
 * Route distincte de `/api/media/[variantId]`, et pas par commodité: ces
 * fichiers ne sont pas les nôtres. Ils viennent de l'extérieur, ils n'ont
 * aucun rating, ils ne partent jamais sur R2 — et leur portée d'autorisation
 * est le fil de discussion, pas l'Asset. Les servir depuis la même route
 * obligerait à y faire cohabiter deux règles d'accès différentes.
 */

const MEDIA_ROOT = resolve(envOr("MEDIA_ROOT", "./media"));

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx) return new NextResponse("Not authenticated", { status: 401 });

  const { attachmentId } = await params;
  const attachment = await prisma.messageAttachment.findFirst({
    where: {
      id: attachmentId,
      message: {
        conversation: {
          channelAccount: { persona: { organizationId: ctx.organizationId } },
        },
      },
    },
    select: { localPath: true },
  });
  // Une pièce jointe d'une autre organisation est traitée comme inexistante:
  // distinguer « interdit » de « absent » dirait déjà qu'elle existe.
  if (!attachment?.localPath) return new NextResponse("Not found", { status: 404 });

  const absolute = join(MEDIA_ROOT, attachment.localPath);
  // Le chemin vient de la base, mais il a été construit à partir de données
  // reçues de l'extérieur: on vérifie qu'il reste sous la racine. `sep` en
  // suffixe pour qu'un répertoire voisin nommé `mediaX` ne passe pas.
  if (!absolute.startsWith(MEDIA_ROOT + sep)) {
    return new NextResponse("Invalid path", { status: 400 });
  }

  try {
    const { size } = await stat(absolute);
    const stream = Readable.toWeb(
      createReadStream(absolute),
    ) as unknown as ReadableStream;

    return new NextResponse(stream, {
      headers: {
        "Content-Type":
          CONTENT_TYPES[extname(absolute).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(size),
        // Jamais `inline` sans type connu: un document reçu ne doit pas
        // s'exécuter dans l'onglet de l'opérateur.
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new NextResponse("File missing from volume", { status: 404 });
  }
}
