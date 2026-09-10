import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/session";
import { envOr } from "@/lib/env";

/**
 * Sert le fichier **original** d'un Asset à un opérateur authentifié.
 *
 * Pendant de la route des Variants: le volume local n'est pas exposé, chaque
 * octet servi passe par une session et par le scope d'organisation (section 5,
 * 9.6). C'est ce qui permet d'afficher l'original sur sa fiche sans le publier
 * nulle part.
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
  { params }: { params: Promise<{ assetId: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx) return new NextResponse("Not authenticated", { status: 401 });

  const { assetId } = await params;
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, persona: { organizationId: ctx.organizationId } },
    select: { localPath: true },
  });
  if (!asset) return new NextResponse("Not found", { status: 404 });

  const absolute = join(MEDIA_ROOT, asset.localPath);
  if (!absolute.startsWith(MEDIA_ROOT)) {
    return new NextResponse("Invalid path", { status: 400 });
  }

  try {
    const { size } = await stat(absolute);
    const stream = Readable.toWeb(createReadStream(absolute)) as unknown as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type":
          CONTENT_TYPES[extname(absolute).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(size),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new NextResponse("File missing from volume", { status: 404 });
  }
}
