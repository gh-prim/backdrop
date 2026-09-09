import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { ApplicationFailure } from "@temporalio/activity";
import { Rating } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../../src/lib/db";

const run = promisify(execFile);

/**
 * Traitement média: ffmpeg, disque local, R2.
 *
 * Le volume local est la source de vérité et n'est jamais servi sur le réseau.
 * R2 ne reçoit que des Variants SFW destinés à Instagram (spec section 5):
 * c'est le second garde-fou anti-NSFW, et il est appliqué ici, une fois.
 */

const MEDIA_ROOT = resolve(process.env.MEDIA_ROOT ?? "./media");

/** Les chemins en base sont relatifs, pour rester valides hôte et conteneur. */
export function absolutePath(relativePath: string): string {
  return join(MEDIA_ROOT, relativePath);
}

const RATIO_VALUES: Record<string, number> = {
  "1:1": 1,
  "4:5": 4 / 5,
  "9:16": 9 / 16,
};

const TARGET_WIDTH = 1080;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

export function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(path).toLowerCase());
}

export type MediaProbe = {
  width: number;
  height: number;
  durationSeconds: number | null;
  isVideo: boolean;
};

export async function probeMedia(relativePath: string): Promise<MediaProbe> {
  const path = absolutePath(relativePath);
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "json",
      path,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream?.height) {
      throw new Error("ffprobe n'a pas renvoyé de dimensions.");
    }
    const duration = parsed.format?.duration
      ? Number.parseFloat(parsed.format.duration)
      : null;

    return {
      width: stream.width,
      height: stream.height,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      isVideo: isVideoPath(relativePath),
    };
  } catch (error) {
    throw ApplicationFailure.create({
      message: `Média illisible (${relativePath}): ${(error as Error).message}`,
      nonRetryable: true,
    });
  }
}

/**
 * Recadrage centré vers le ratio cible, puis mise à l'échelle.
 * `-2` sur la hauteur garantit un nombre pair, exigé par yuv420p.
 */
function cropFilter(ratio: string): string {
  const value = RATIO_VALUES[ratio];
  if (!value) {
    throw ApplicationFailure.create({
      message: `Ratio non supporté: ${ratio}`,
      nonRetryable: true,
    });
  }
  return `crop='min(iw,ih*${value})':'min(ih,iw/${value})',scale=${TARGET_WIDTH}:-2`;
}

export type TranscodeInput = {
  sourcePath: string;
  ratio: string;
  /** Chemin relatif de sortie, sans extension. */
  outputBase: string;
};

export async function transcodeVariant(
  input: TranscodeInput,
): Promise<{ localPath: string }> {
  const source = absolutePath(input.sourcePath);
  const video = isVideoPath(input.sourcePath);
  const relativeOutput = `${input.outputBase}${video ? ".mp4" : ".jpg"}`;
  const output = absolutePath(relativeOutput);

  await mkdir(dirname(output), { recursive: true });

  const filter = cropFilter(input.ratio);
  const args = video
    ? [
        "-y", "-i", source,
        "-vf", filter,
        // Specs 4.1.7: H264, AAC 48 kHz, et surtout le moov atom en tête.
        // Un fichier non conforme échoue au stade container, souvent sans
        // message exploitable.
        "-c:v", "libx264",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "48000",
        "-movflags", "+faststart",
        output,
      ]
    : ["-y", "-i", source, "-vf", filter, "-q:v", "2", output];

  try {
    await run("ffmpeg", args, { maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    throw ApplicationFailure.create({
      message: `ffmpeg a échoué sur ${input.sourcePath} (${input.ratio}): ${
        (error as Error).message
      }`,
      nonRetryable: true,
    });
  }

  await stat(output);
  return { localPath: relativeOutput };
}

export async function createVariantRecord(input: {
  assetId: string;
  ratio: string;
  localPath: string;
}): Promise<{ variantId: string }> {
  const existing = await prisma.variant.findFirst({
    where: { assetId: input.assetId, ratio: input.ratio },
    select: { id: true },
  });

  if (existing) {
    await prisma.variant.update({
      where: { id: existing.id },
      data: { localPath: input.localPath },
    });
    return { variantId: existing.id };
  }

  const variant = await prisma.variant.create({
    data: { assetId: input.assetId, ratio: input.ratio, localPath: input.localPath },
    select: { id: true },
  });
  return { variantId: variant.id };
}

function r2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

/**
 * Pousse un Variant sur R2, **et seulement s'il est SFW**.
 *
 * Le rating est relu en base ici, pas reçu en paramètre: une activité qui
 * accepterait « c'est SFW, promis » de son appelant ne serait pas un garde-fou.
 */
export async function uploadVariantToR2(
  variantId: string,
): Promise<{ r2Key: string | null; skipped: "not_sfw" | "no_r2_config" | null }> {
  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      ratio: true,
      localPath: true,
      asset: { select: { rating: true, personaId: true } },
    },
  });

  if (!variant) {
    throw ApplicationFailure.create({
      message: `Variant ${variantId} introuvable.`,
      nonRetryable: true,
    });
  }

  if (variant.asset.rating !== Rating.SFW) {
    // Un Asset non SFW n'a physiquement pas d'URL publique à fournir à Meta,
    // même en cas de bug applicatif ailleurs (section 5).
    return { r2Key: null, skipped: "not_sfw" };
  }

  const client = r2Client();
  const bucket = process.env.R2_BUCKET;
  if (!client || !bucket) {
    return { r2Key: null, skipped: "no_r2_config" };
  }

  const extension = extname(variant.localPath).toLowerCase();
  const key = `${variant.asset.personaId}/${variant.id}${extension}`;
  const absolute = absolutePath(variant.localPath);
  const { size } = await stat(absolute);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(absolute),
      ContentLength: size,
      ContentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
    }),
  );

  await prisma.variant.update({ where: { id: variantId }, data: { r2Key: key } });
  return { r2Key: key, skipped: null };
}

export async function loadAssetForIngest(assetId: string): Promise<{
  assetId: string;
  personaId: string;
  rating: string;
  localPath: string;
}> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { id: true, personaId: true, rating: true, localPath: true },
  });
  if (!asset) {
    throw ApplicationFailure.create({
      message: `Asset ${assetId} introuvable.`,
      nonRetryable: true,
    });
  }
  return {
    assetId: asset.id,
    personaId: asset.personaId,
    rating: asset.rating,
    localPath: asset.localPath,
  };
}
