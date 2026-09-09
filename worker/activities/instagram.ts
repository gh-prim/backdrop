import { ApplicationFailure } from "@temporalio/activity";
import { Platform } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { decryptCredentials, encryptCredentials } from "../../src/lib/crypto";
import {
  InstagramAdapter,
  type CreateContainerInput,
  type InstagramCredentials,
} from "../../src/lib/channels/instagram";
import { ChannelError, type QuotaStatus } from "../../src/lib/channels/types";

/**
 * Activités Instagram.
 *
 * Chaque activité résout ses credentials elle-même à partir du
 * `channelAccountId`: rien de secret ne transite par l'historique Temporal.
 */

async function adapterFor(channelAccountId: string): Promise<InstagramAdapter> {
  const account = await prisma.channelAccount.findUnique({
    where: { id: channelAccountId },
    select: { platform: true, credentials: true },
  });

  if (!account) {
    throw ApplicationFailure.create({
      message: `ChannelAccount ${channelAccountId} introuvable.`,
      nonRetryable: true,
    });
  }
  if (account.platform !== Platform.INSTAGRAM) {
    throw ApplicationFailure.create({
      message: `ChannelAccount ${channelAccountId} n'est pas Instagram.`,
      nonRetryable: true,
    });
  }

  const credentials = decryptCredentials<InstagramCredentials>(account.credentials);
  return new InstagramAdapter(credentials);
}

/** Traduit une erreur d'adapter en échec Temporal, en préservant `retryable`. */
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
 * Interroger le quota avant d'envoyer, plutôt que d'encaisser l'erreur 9
 * (4.1.8). Le plafond lu est celui que Meta annonce.
 */
export async function checkInstagramQuota(
  channelAccountId: string,
): Promise<QuotaStatus> {
  const adapter = await adapterFor(channelAccountId);
  try {
    return await adapter.checkQuota();
  } catch (error) {
    toFailure(error);
  }
}

export async function createInstagramContainer(
  channelAccountId: string,
  input: CreateContainerInput,
): Promise<string> {
  const adapter = await adapterFor(channelAccountId);
  try {
    return await adapter.createContainer(input);
  } catch (error) {
    toFailure(error);
  }
}

/**
 * Un seul sondage. La boucle d'attente vit dans le workflow, où elle est
 * durable et visible dans Temporal UI, plutôt que dans une activité qui
 * bloquerait un worker pendant plusieurs minutes.
 */
export async function getInstagramContainerStatus(
  channelAccountId: string,
  containerId: string,
): Promise<{ status: string; error?: string }> {
  const adapter = await adapterFor(channelAccountId);
  try {
    return await adapter.getContainerStatus(containerId);
  } catch (error) {
    toFailure(error);
  }
}

export async function publishInstagramContainer(
  channelAccountId: string,
  creationId: string,
): Promise<string> {
  const adapter = await adapterFor(channelAccountId);
  try {
    return await adapter.publishContainer(creationId);
  } catch (error) {
    toFailure(error);
  }
}

export async function fetchInstagramMetrics(
  channelAccountId: string,
  remoteId: string,
): Promise<Record<string, unknown>> {
  const adapter = await adapterFor(channelAccountId);
  try {
    return await adapter.fetchMetrics(remoteId);
  } catch (error) {
    toFailure(error);
  }
}

/** Comptes Instagram à rafraîchir. Identifiants seulement (9.7). */
export async function listInstagramChannelAccountIds(): Promise<string[]> {
  const rows = await prisma.channelAccount.findMany({
    where: { platform: Platform.INSTAGRAM },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Échange du long-lived token (4.1.9). Le nouveau token est rechiffré et
 * réécrit sans jamais sortir de cette activité.
 */
export async function refreshInstagramToken(
  channelAccountId: string,
): Promise<{ expiresAt: string }> {
  const account = await prisma.channelAccount.findUnique({
    where: { id: channelAccountId },
    select: { credentials: true, platform: true },
  });
  if (!account || account.platform !== Platform.INSTAGRAM) {
    throw ApplicationFailure.create({
      message: `ChannelAccount ${channelAccountId} inexploitable pour un refresh Meta.`,
      nonRetryable: true,
    });
  }

  const credentials = decryptCredentials<InstagramCredentials>(account.credentials);
  const adapter = new InstagramAdapter(credentials);

  try {
    const { accessToken, expiresAt } = await adapter.refreshLongLivedToken();
    await prisma.channelAccount.update({
      where: { id: channelAccountId },
      data: {
        credentials: encryptCredentials({ ...credentials, accessToken }),
        tokenExpiresAt: expiresAt,
      },
    });
    return { expiresAt: expiresAt.toISOString() };
  } catch (error) {
    toFailure(error);
  }
}
