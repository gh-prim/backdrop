import "server-only";
import { z } from "zod";
import { Platform, Rating } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  decryptCredentials,
  encryptCredentials,
  openWithPassphrase,
  sealWithPassphrase,
  type SealedBox,
} from "@/lib/crypto";
import type { OrgContext } from "@/lib/session";

/**
 * Sauvegarde de **configuration**, pas de contenu.
 *
 * Ce qui part: personas, canaux, applications Telegram, hashtags connus,
 * albums. Ce qui ne part pas: les médias et les publications — le premier pèse
 * des gigaoctets et vit sur un volume, le second est un journal d'envois qui
 * n'a aucun sens transplanté ailleurs.
 *
 * Rien n'est identifié par son cuid: une autre instance en a d'autres. Tout se
 * recolle sur des clés naturelles — le handle d'une persona, le couple
 * (plateforme, identifiant distant) d'un canal, le nom d'un album, le sha256
 * d'un média.
 */
/**
 * Erreur destinée à l'opérateur, et la seule dont le texte remonte au
 * navigateur.
 *
 * Une exception Prisma qui traverserait la même voie afficherait l'URL de la
 * base, mot de passe compris: c'est déjà arrivé une fois, et le marqueur de
 * type est ce qui l'empêche de se reproduire.
 */
export class OperatorError extends Error {}

export const CONFIG_FORMAT = "backdrop.config";
export const CONFIG_VERSION = 1;

const sealedBox = z.object({
  algorithm: z.literal("aes-256-gcm"),
  kdf: z.literal("scrypt"),
  salt: z.string(),
  iv: z.string(),
  tag: z.string(),
  ciphertext: z.string(),
});

const hashtagSchema = z.object({
  name: z.string(),
  hashtagId: z.string().nullable(),
  topMedianLikes: z.number().int().nullable(),
  checkedAt: z.string(),
});

const channelSchema = z.object({
  platform: z.nativeEnum(Platform),
  externalId: z.string(),
  maxRating: z.nativeEnum(Rating),
  scheduleToleranceMinutes: z.number().int().nullable(),
  tokenExpiresAt: z.string().nullable(),
  hashtags: z.array(hashtagSchema),
});

const albumSchema = z.object({
  name: z.string(),
  /** Médias désignés par leur empreinte: les fichiers ne voyagent pas. */
  itemChecksums: z.array(z.string()),
});

const personaSchema = z.object({
  handle: z.string(),
  name: z.string(),
  timezone: z.string(),
  audienceTimezone: z.string().nullable(),
  bible: z.unknown(),
  hasTelegramApp: z.boolean(),
  channels: z.array(channelSchema),
  albums: z.array(albumSchema),
});

export const configSchema = z.object({
  format: z.literal(CONFIG_FORMAT),
  version: z.literal(CONFIG_VERSION),
  exportedAt: z.string(),
  organization: z.object({ name: z.string(), slug: z.string() }),
  personas: z.array(personaSchema),
  /**
   * Identifiants plateforme, chiffrés sous la phrase de passe de l'opérateur.
   *
   * `null` quand l'export a été demandé sans: le fichier décrit alors la forme
   * de l'installation sans en donner les clés, et l'import recréera tout sauf
   * les canaux — un canal sans identifiants n'est pas un canal à moitié
   * connecté, c'est un canal qui échoue au premier envoi.
   */
  secrets: sealedBox.nullable(),
});

export type ConfigBackup = z.infer<typeof configSchema>;

/** Contenu chiffré du coffre: en clair uniquement côté serveur. */
type Secrets = {
  channels: Record<string, unknown>;
  telegramApps: Record<string, unknown>;
  /**
   * Application OAuth Fanvue de l'organisation. Sans elle, une instance
   * restaurée a bien ses canaux Fanvue mais aucun moyen de les réautoriser:
   * le parcours n'a plus de `client_id` à présenter.
   */
  fanvueApp?: unknown;
};

/** Clé naturelle d'un canal, stable d'une instance à l'autre. */
function channelKey(handle: string, platform: Platform, externalId: string) {
  return `${handle}/${platform}/${externalId}`;
}

export async function exportConfig(
  ctx: OrgContext,
  options: { passphrase?: string } = {},
): Promise<ConfigBackup> {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { name: true, slug: true },
  });

  const personas = await prisma.persona.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { handle: "asc" },
    select: {
      handle: true,
      name: true,
      timezone: true,
      audienceTimezone: true,
      bible: true,
      telegramApp: { select: { credentials: true } },
      channels: {
        orderBy: [{ platform: "asc" }, { externalId: "asc" }],
        select: {
          platform: true,
          externalId: true,
          credentials: true,
          maxRating: true,
          scheduleToleranceMinutes: true,
          tokenExpiresAt: true,
          hashtags: {
            orderBy: { name: "asc" },
            select: {
              name: true,
              hashtagId: true,
              topMedianLikes: true,
              checkedAt: true,
            },
          },
        },
      },
      albums: {
        orderBy: { name: "asc" },
        select: {
          name: true,
          items: {
            orderBy: { position: "asc" },
            select: { asset: { select: { sha256: true } } },
          },
        },
      },
    },
  });

  const secrets: Secrets = { channels: {}, telegramApps: {} };

  if (options.passphrase) {
    const app = await prisma.fanvueApp.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { credentials: true },
    });
    if (app) secrets.fanvueApp = decryptCredentials(app.credentials);
  }

  const exported = personas.map((persona) => {
    if (options.passphrase) {
      // Déchiffré avec la clé maître de **cette** instance, puis rechiffré
      // sous la phrase de passe: la clé maître ne quitte jamais le serveur, et
      // le navigateur ne voit qu'un bloc opaque (9.7).
      for (const channel of persona.channels) {
        secrets.channels[channelKey(persona.handle, channel.platform, channel.externalId)] =
          decryptCredentials(channel.credentials);
      }
      if (persona.telegramApp) {
        secrets.telegramApps[persona.handle] = decryptCredentials(
          persona.telegramApp.credentials,
        );
      }
    }

    return {
      handle: persona.handle,
      name: persona.name,
      timezone: persona.timezone,
      audienceTimezone: persona.audienceTimezone,
      bible: persona.bible,
      hasTelegramApp: persona.telegramApp !== null,
      channels: persona.channels.map((channel) => ({
        platform: channel.platform,
        externalId: channel.externalId,
        maxRating: channel.maxRating,
        scheduleToleranceMinutes: channel.scheduleToleranceMinutes,
        tokenExpiresAt: channel.tokenExpiresAt?.toISOString() ?? null,
        hashtags: channel.hashtags.map((hashtag) => ({
          ...hashtag,
          checkedAt: hashtag.checkedAt.toISOString(),
        })),
      })),
      albums: persona.albums.map((album) => ({
        name: album.name,
        itemChecksums: album.items.map((item) => item.asset.sha256),
      })),
    };
  });

  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    organization,
    personas: exported,
    secrets: options.passphrase
      ? sealWithPassphrase(secrets, options.passphrase)
      : null,
  };
}

export type ImportPlan = {
  personasCreated: string[];
  personasUpdated: string[];
  channelsCreated: string[];
  channelsUpdated: string[];
  /** Canaux laissés de côté, avec la raison. */
  channelsSkipped: { key: string; reason: string }[];
  telegramAppsCreated: string[];
  hashtags: number;
  albumsCreated: string[];
  /** Médias qu'aucune empreinte locale ne retrouve: albums incomplets. */
  missingMedia: number;
  /** L'application OAuth Fanvue a été rétablie. */
  fanvueApp: boolean;
};

function emptyPlan(): ImportPlan {
  return {
    personasCreated: [],
    personasUpdated: [],
    channelsCreated: [],
    channelsUpdated: [],
    channelsSkipped: [],
    telegramAppsCreated: [],
    hashtags: 0,
    albumsCreated: [],
    missingMedia: 0,
    fanvueApp: false,
  };
}

/**
 * Rejoue une configuration dans l'organisation courante.
 *
 * Idempotent et **jamais destructeur**: ce qui existe est mis à jour, ce qui
 * manque est créé, rien n'est supprimé. Réimporter deux fois le même fichier
 * doit laisser l'instance dans le même état, et un import ne doit pas pouvoir
 * effacer un canal qu'on venait de reconnecter à la main.
 *
 * `dryRun` fait tout le travail de résolution sans écrire: c'est ce qui permet
 * d'annoncer le plan avant de l'appliquer.
 */
export async function importConfig(
  ctx: OrgContext,
  backup: ConfigBackup,
  options: { passphrase?: string; dryRun?: boolean } = {},
): Promise<ImportPlan> {
  const plan = emptyPlan();
  const dryRun = options.dryRun ?? false;

  let secrets: Secrets | null = null;
  if (backup.secrets) {
    if (!options.passphrase) {
      throw new OperatorError(
        "This file carries credentials: the passphrase is required.",
      );
    }
    try {
      secrets = openWithPassphrase<Secrets>(backup.secrets, options.passphrase);
    } catch {
      // Le message reste volontairement pauvre: distinguer « mauvaise phrase »
      // de « fichier altéré » renseignerait qui essaie des phrases au hasard.
      throw new OperatorError("Wrong passphrase, or the file has been altered.");
    }
  }

  if (secrets?.fanvueApp !== undefined) {
    plan.fanvueApp = true;
    if (!dryRun) {
      const blob = encryptCredentials(secrets.fanvueApp);
      await prisma.fanvueApp.upsert({
        where: { organizationId: ctx.organizationId },
        create: { organizationId: ctx.organizationId, credentials: blob },
        update: { credentials: blob },
      });
    }
  }

  for (const persona of backup.personas) {
    const existing = await prisma.persona.findFirst({
      where: { organizationId: ctx.organizationId, handle: persona.handle },
      select: { id: true },
    });

    let personaId = existing?.id ?? "";
    if (existing) {
      plan.personasUpdated.push(persona.handle);
      if (!dryRun) {
        await prisma.persona.update({
          where: { id: existing.id },
          data: {
            name: persona.name,
            timezone: persona.timezone,
            audienceTimezone: persona.audienceTimezone,
            bible: (persona.bible ?? {}) as object,
          },
        });
      }
    } else {
      plan.personasCreated.push(persona.handle);
      if (!dryRun) {
        const created = await prisma.persona.create({
          data: {
            organizationId: ctx.organizationId,
            handle: persona.handle,
            name: persona.name,
            timezone: persona.timezone,
            audienceTimezone: persona.audienceTimezone,
            bible: (persona.bible ?? {}) as object,
          },
          select: { id: true },
        });
        personaId = created.id;
      }
    }

    const telegramSecret = secrets?.telegramApps[persona.handle];
    if (persona.hasTelegramApp) {
      if (telegramSecret === undefined) {
        plan.channelsSkipped.push({
          key: `${persona.handle}/telegram-app`,
          reason: "no credentials in this file",
        });
      } else {
        plan.telegramAppsCreated.push(persona.handle);
        if (!dryRun && personaId) {
          await prisma.telegramApp.upsert({
            where: { personaId },
            create: { personaId, credentials: encryptCredentials(telegramSecret) },
            update: { credentials: encryptCredentials(telegramSecret) },
          });
        }
      }
    }

    for (const channel of persona.channels) {
      const key = channelKey(persona.handle, channel.platform, channel.externalId);
      const secret = secrets?.channels[key];

      const current = personaId
        ? await prisma.channelAccount.findFirst({
            where: {
              personaId,
              platform: channel.platform,
              externalId: channel.externalId,
            },
            select: { id: true },
          })
        : null;

      if (!current && secret === undefined) {
        // Créer un canal sans identifiants donnerait une tuile « connectée »
        // qui échoue au premier envoi. On le dit, et on laisse l'opérateur le
        // reconnecter lui-même.
        plan.channelsSkipped.push({ key, reason: "no credentials in this file" });
        continue;
      }

      const data = {
        maxRating: channel.maxRating,
        scheduleToleranceMinutes: channel.scheduleToleranceMinutes,
        tokenExpiresAt: channel.tokenExpiresAt ? new Date(channel.tokenExpiresAt) : null,
        ...(secret === undefined ? {} : { credentials: encryptCredentials(secret) }),
      };

      let channelId = current?.id ?? "";
      if (current) {
        plan.channelsUpdated.push(key);
        if (!dryRun) {
          await prisma.channelAccount.update({ where: { id: current.id }, data });
        }
      } else {
        plan.channelsCreated.push(key);
        if (!dryRun && personaId) {
          const created = await prisma.channelAccount.create({
            data: {
              personaId,
              platform: channel.platform,
              externalId: channel.externalId,
              credentials: encryptCredentials(secret),
              ...data,
            },
            select: { id: true },
          });
          channelId = created.id;
        }
      }

      plan.hashtags += channel.hashtags.length;
      if (!dryRun && channelId) {
        for (const hashtag of channel.hashtags) {
          // Les hashtags portent des identifiants Meta obtenus au prix d'une
          // recherche plafonnée à 30 par semaine: les réimporter, c'est
          // exactement ce qui évite de rebrûler ce quota sur la nouvelle
          // instance.
          await prisma.instagramHashtag.upsert({
            where: {
              channelAccountId_name: { channelAccountId: channelId, name: hashtag.name },
            },
            create: {
              channelAccountId: channelId,
              name: hashtag.name,
              hashtagId: hashtag.hashtagId,
              topMedianLikes: hashtag.topMedianLikes,
              checkedAt: new Date(hashtag.checkedAt),
            },
            update: {
              hashtagId: hashtag.hashtagId,
              topMedianLikes: hashtag.topMedianLikes,
              checkedAt: new Date(hashtag.checkedAt),
            },
          });
        }
      }
    }

    for (const album of persona.albums) {
      // Les médias ne voyagent pas: l'album se recolle sur les empreintes
      // présentes ici, et l'absence des autres est annoncée plutôt que tue.
      const assets = personaId
        ? await prisma.asset.findMany({
            where: { personaId, sha256: { in: album.itemChecksums } },
            select: { id: true, sha256: true },
          })
        : [];

      const byChecksum = new Map(assets.map((asset) => [asset.sha256, asset.id]));
      const found = album.itemChecksums.filter((sha) => byChecksum.has(sha));
      plan.missingMedia += album.itemChecksums.length - found.length;

      const already = personaId
        ? await prisma.album.findFirst({
            where: { personaId, name: album.name },
            select: { id: true },
          })
        : null;
      if (already) continue;

      plan.albumsCreated.push(album.name);
      if (!dryRun && personaId) {
        await prisma.album.create({
          data: {
            personaId,
            name: album.name,
            items: {
              create: found.map((sha, position) => ({
                assetId: byChecksum.get(sha)!,
                position,
              })),
            },
          },
        });
      }
    }
  }

  return plan;
}
