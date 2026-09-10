import { readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { ApplicationFailure } from "@temporalio/activity";
import { Platform } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { envOr } from "../../src/lib/env";
import { fanvueAdapterFor } from "../../src/lib/channels/fanvue-account";
import {
  MIN_PRICE_CENTS,
  type FanvueAudience,
  type FanvueMediaType,
} from "../../src/lib/channels/fanvue";
import { ChannelError } from "../../src/lib/channels/types";

/**
 * Activités Fanvue (4.3).
 *
 * Même discipline que côté Instagram: chaque activité résout ses credentials
 * elle-même à partir du `channelAccountId`, et rien de secret ne traverse
 * l'historique Temporal.
 */

const MEDIA_ROOT = resolve(envOr("MEDIA_ROOT", "./media"));
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

async function adapterFor(channelAccountId: string) {
  const adapter = await fanvueAdapterFor(channelAccountId);
  if (!adapter) {
    throw ApplicationFailure.create({
      message: `No Fanvue account ${channelAccountId}.`,
      nonRetryable: true,
    });
  }
  return adapter;
}

function toFailure(error: unknown): never {
  if (error instanceof ChannelError) {
    throw ApplicationFailure.create({
      message: error.message,
      type: error.code,
      nonRetryable: !error.retryable,
    });
  }
  throw error;
}

/**
 * Pousse une variante dans le Vault et rend son `mediaUuid`.
 *
 * Les octets partent d'ici, jamais d'une URL publique: Fanvue ne va rien
 * chercher lui-même, et c'est ce qui permet de lui envoyer du NSFW sans que
 * rien ne transite par R2 (4.3.5, section 5).
 *
 * L'identifiant est mémorisé sur la Variant: réenvoyer le même fichier à
 * chaque publication gaspillerait la bande passante et remplirait le Vault de
 * doublons.
 */
export async function uploadFanvueMedia(input: {
  channelAccountId: string;
  variantId: string;
}): Promise<{ mediaUuid: string; reused: boolean }> {
  const variant = await prisma.variant.findUnique({
    where: { id: input.variantId },
    select: { localPath: true, fvMediaUuid: true, asset: { select: { name: true } } },
  });
  if (!variant) {
    throw ApplicationFailure.create({
      message: `Variant ${input.variantId} not found.`,
      nonRetryable: true,
    });
  }
  if (variant.fvMediaUuid) return { mediaUuid: variant.fvMediaUuid, reused: true };

  const adapter = await adapterFor(input.channelAccountId);
  const filename = basename(variant.localPath);
  const extension = extname(filename).toLowerCase();
  const mediaType: FanvueMediaType = VIDEO_EXTENSIONS.has(extension)
    ? "video"
    : "image";

  try {
    const bytes = await readFile(join(MEDIA_ROOT, variant.localPath));
    const mediaUuid = await adapter.uploadMedia({
      name: variant.asset.name || filename,
      filename,
      mediaType,
      bytes: new Uint8Array(bytes),
    });

    await prisma.variant.update({
      where: { id: input.variantId },
      data: { fvMediaUuid: mediaUuid },
    });
    return { mediaUuid, reused: false };
  } catch (error) {
    toFailure(error);
  }
}

/**
 * Attend qu'un média soit exploitable.
 *
 * Tant qu'il n'est pas final, `GET /v1/media/{uuid}` ne renvoie que son état:
 * attacher un média en cours de traitement, c'est publier un post à la
 * vignette cassée (4.3.5).
 */
export async function awaitFanvueMedia(input: {
  channelAccountId: string;
  mediaUuid: string;
}): Promise<{ status: string }> {
  const adapter = await adapterFor(input.channelAccountId);
  try {
    const status = await adapter.mediaStatus(input.mediaUuid);
    if (status === "error") {
      throw ApplicationFailure.create({
        message: `Fanvue could not process media ${input.mediaUuid}.`,
        type: "FANVUE_MEDIA_ERROR",
        nonRetryable: true,
      });
    }
    if (status !== "ready") {
      // Réessayable: c'est la politique de retry de l'activité qui fait
      // l'attente, plutôt qu'une boucle qui dormirait dans l'activité.
      throw ApplicationFailure.create({
        message: `Media ${input.mediaUuid} is ${status}.`,
        type: "FANVUE_MEDIA_PENDING",
      });
    }
    return { status };
  } catch (error) {
    if (error instanceof ApplicationFailure) throw error;
    toFailure(error);
  }
}

/**
 * Crée le post.
 *
 * L'API n'offre aucune idempotence sur cette écriture (4.3.9): un timeout
 * réseau après un appel déjà traité produirait un doublon au retry. Avant de
 * poster, on relit donc les posts récents et on cherche le nôtre.
 */
export async function createFanvuePost(input: {
  channelAccountId: string;
  publicationId: string;
  audience: FanvueAudience;
  text: string;
  mediaUuids: string[];
  mediaPreviewUuid?: string;
  priceCents?: number;
}): Promise<{ remoteId: string; deduplicated: boolean }> {
  const adapter = await adapterFor(input.channelAccountId);

  try {
    const recent = await adapter.recentPosts(10);
    const twin = recent.find(
      (post) =>
        (post.text ?? "") === input.text &&
        (post.price ?? null) === (input.priceCents ?? null),
    );
    if (twin) return { remoteId: twin.uuid, deduplicated: true };

    const post = await adapter.createPost({
      audience: input.audience,
      text: input.text || undefined,
      mediaUuids: input.mediaUuids,
      mediaPreviewUuid: input.mediaPreviewUuid,
      price: input.priceCents,
    });
    return { remoteId: post.uuid, deduplicated: false };
  } catch (error) {
    toFailure(error);
  }
}

/** Vérifie la connexion sans rien publier: sert au dry run et aux réglages. */
export async function checkFanvueAccount(input: {
  channelAccountId: string;
}): Promise<{ handle: string; uuid: string }> {
  const adapter = await adapterFor(input.channelAccountId);
  try {
    const me = await adapter.me();
    return { handle: me.handle, uuid: me.uuid };
  } catch (error) {
    toFailure(error);
  }
}

/** Garde-fou de prix, partagé par le composeur et le worker. */
export function assertFanvuePrice(priceCents: number | undefined) {
  if (priceCents !== undefined && priceCents < MIN_PRICE_CENTS) {
    throw ApplicationFailure.create({
      message: `A paid Fanvue post starts at ${MIN_PRICE_CENTS} cents.`,
      nonRetryable: true,
    });
  }
}

/** Les comptes Fanvue d'une persona, pour les écrans de réglage. */
export async function listFanvueAccounts(personaId: string) {
  return prisma.channelAccount.findMany({
    where: { personaId, platform: Platform.FANVUE },
    select: { id: true, externalId: true, tokenExpiresAt: true },
  });
}
