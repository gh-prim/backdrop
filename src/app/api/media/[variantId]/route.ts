import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/session";
import { envOr } from "@/lib/env";

/**
 * Lecture d'un média local par un opérateur authentifié.
 *
 * Ce n'est pas un serveur de fichiers: le volume local reste non exposé
 * (section 5). Chaque octet servi ici passe par une session valide et par le
 * scope d'organisation, comme n'importe quelle autre lecture.
 */

const MEDIA_ROOT = resolve(envOr("MEDIA_ROOT", "./media"));

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx) return new NextResponse("Not authenticated", { status: 401 });

  const { variantId } = await params;
  const variant = await prisma.variant.findFirst({
    where: {
      id: variantId,
      asset: { persona: { organizationId: ctx.organizationId } },
    },
    select: { localPath: true },
  });
  // Un média d'une autre organisation est traité comme inexistant.
  if (!variant) return new NextResponse("Not found", { status: 404 });

  const absolute = join(MEDIA_ROOT, variant.localPath);
  if (!absolute.startsWith(MEDIA_ROOT)) {
    return new NextResponse("Invalid path", { status: 400 });
  }

  try {
    const { size } = await stat(absolute);
    const stream = Readable.toWeb(
      createReadStream(absolute),
    ) as unknown as ReadableStream;

    return new NextResponse(stream, {
      headers: {
        "Content-Type": CONTENT_TYPES[extname(absolute).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(size),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new NextResponse("File missing from volume", { status: 404 });
  }
}
