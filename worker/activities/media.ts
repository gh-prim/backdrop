import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { ApplicationFailure } from "@temporalio/activity";
import { Rating } from "@prisma/client";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../../src/lib/db";
import { objectStorageClient } from "../../src/lib/storage";
import { envOr } from "../../src/lib/env";

const run = promisify(execFile);

/**
 * Traitement média: ffmpeg, disque local, R2.
 *
 * Le volume local est la source de vérité et n'est jamais servi sur le réseau.
 * R2 ne reçoit que des Variants SFW destinés à Instagram (spec section 5):
 * c'est le second garde-fou anti-NSFW, et il est appliqué ici, une fois.
 */

const MEDIA_ROOT = resolve(envOr("MEDIA_ROOT", "./media"));

/** Les chemins en base sont relatifs, pour rester valides hôte et conteneur. */
export function absolutePath(relativePath: string): string {
  return join(MEDIA_ROOT, relativePath);
}

const RATIO_VALUES: Record<string, number> = {
  "1:1": 1,
  // Le plus haut que le fil Instagram accepte depuis 2026: à partir d'un
  // master 1440x1920, il se publie sans rien perdre.
  "3:4": 3 / 4,
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

/**
 * Relève et **persiste** les métadonnées de l'Asset.
 *
 * `probeMedia` sondait déjà le fichier pour valider qu'il est lisible; on jetait
 * le résultat. L'écrire évite de resonder le disque à chaque affichage de la
 * fiche d'un média.
 */
export async function probeAndStoreAsset(assetId: string): Promise<MediaProbe> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { localPath: true },
  });
  if (!asset) {
    throw ApplicationFailure.create({
      message: `Asset ${assetId} not found.`,
      nonRetryable: true,
    });
  }

  const probe = await probeMedia(asset.localPath);
  const { size } = await stat(absolutePath(asset.localPath));

  await prisma.asset.update({
    where: { id: assetId },
    data: {
      width: probe.width,
      height: probe.height,
      durationMs: probe.durationSeconds
        ? Math.round(probe.durationSeconds * 1000)
        : null,
      sizeBytes: size,
    },
  });

  return probe;
}

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
      message: `Unreadable media (${relativePath}): ${(error as Error).message}`,
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
      message: `Unsupported ratio: ${ratio}`,
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
      message: `ffmpeg failed on ${input.sourcePath} (${input.ratio}): ${
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
      message: `Variant ${variantId} not found.`,
      nonRetryable: true,
    });
  }

  if (variant.asset.rating !== Rating.SFW) {
    // Un Asset non SFW n'a physiquement pas d'URL publique à fournir à Meta,
    // même en cas de bug applicatif ailleurs (section 5).
    return { r2Key: null, skipped: "not_sfw" };
  }

  const client = objectStorageClient();
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

/**
 * Durée d'un Reel fabriqué à partir d'une photo. Instagram refuse en dessous
 * de trois secondes; huit laisse le temps d'entendre la musique.
 */
const STILL_REEL_SECONDS = 8;

/**
 * Transforme une photo en vidéo publiable en Reel.
 *
 * L'API n'accepte aucun paramètre audio sur un container IMAGE (4.1.5): pour
 * poser une musique sur une photo, il faut lui donner une vidéo. C'est
 * exactement ce que fait l'application mobile quand on ajoute une piste à un
 * post photo.
 *
 * Une piste audio silencieuse est ajoutée: un Reel sans flux audio du tout est
 * refusé par l'encodage côté Meta, et c'est `audio_configuration` qui apportera
 * la musique.
 *
 * Idempotent: le rendu est nommé d'après le Variant, donc rejouer l'activité
 * réécrit le même fichier au lieu d'en accumuler.
 */
export async function renderStillAsReel(
  variantId: string,
): Promise<{ publicUrl: string | null; skipped: "not_sfw" | "no_r2_config" | null }> {
  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      localPath: true,
      asset: { select: { rating: true, personaId: true } },
    },
  });
  if (!variant) {
    throw ApplicationFailure.create({
      message: `Variant ${variantId} not found.`,
      nonRetryable: true,
    });
  }

  // Même garde-fou que pour l'upload: un Asset non SFW n'obtient jamais
  // d'URL publique, quel que soit le format dans lequel on l'emballe.
  if (variant.asset.rating !== Rating.SFW) {
    return { publicUrl: null, skipped: "not_sfw" };
  }

  const relativeOutput = join("reels", `${variant.id}.mp4`);
  const output = absolutePath(relativeOutput);
  await mkdir(dirname(output), { recursive: true });

  try {
    await run(
      "ffmpeg",
      [
        "-y",
        "-loop", "1", "-i", absolutePath(variant.localPath),
        // Piste silencieuse: la musique viendra d'Instagram.
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-t", String(STILL_REEL_SECONDS),
        // 9:16 plein cadre, dimensions paires exigées par yuv420p.
        "-vf", "scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        "-r", "30",
        "-c:v", "libx264",
        "-profile:v", "high",
        "-preset", "medium",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "48000",
        "-shortest",
        "-movflags", "+faststart",
        output,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (error) {
    throw ApplicationFailure.create({
      message: `Photo Reel render failed (${variant.localPath}): ${(error as Error).message}`,
      nonRetryable: true,
    });
  }

  const client = objectStorageClient();
  const bucket = process.env.R2_BUCKET;
  if (!client || !bucket) return { publicUrl: null, skipped: "no_r2_config" };

  const key = `${variant.asset.personaId}/${variant.id}-reel.mp4`;
  const { size } = await stat(output);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(output),
      ContentLength: size,
      ContentType: "video/mp4",
    }),
  );

  const base = process.env.R2_PUBLIC_BASE_URL;
  return {
    publicUrl: base ? `${base.replace(/\/$/, "")}/${key}` : null,
    skipped: null,
  };
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
      message: `Asset ${assetId} not found.`,
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
