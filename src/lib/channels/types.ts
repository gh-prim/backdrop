import type { Platform, PubKind, Rating } from "@prisma/client";

/**
 * Contrat d'adapter (spec 7.5).
 *
 * Les capacités sont déclarées en **données**, pas en branchements dispersés.
 * Règle: aucun `if (platform === "instagram")` en dehors des adapters.
 */

export type ChannelCapabilities = {
  platform: Platform;
  /** Rating maximal admissible. Instagram est SFW, sans exception (8). */
  maxRating: Rating;
  kinds: PubKind[];
  /** Nombre d'éléments par publication. Carrousel Instagram: 10 (4.1.4). */
  maxItems: number;
  maxCaptionLength: number;
  ratios: string[];
  /**
   * La plateforme va-t-elle chercher le fichier elle-même sur une URL publique?
   * Vrai pour Instagram seulement (4.1.6), et c'est la raison d'être de R2.
   */
  requiresPublicUrl: boolean;
  /**
   * Programmation native. Toujours déclarée pour mémoire, jamais utilisée:
   * l'horloge est tenue par l'application sur tous les canaux (7.6).
   */
  nativeScheduling: boolean;
};

export type QuotaStatus = {
  /** Publications déjà faites dans la fenêtre glissante. */
  used: number;
  /** Plafond annoncé par la plateforme, pas une constante en dur. */
  limit: number;
  remaining: number;
};

export type PublishMetrics = Record<string, number | string | null>;

/**
 * Erreur normalisée de plateforme.
 *
 * `retryable` est ce que lit la retry policy Temporal: une erreur non
 * réessayable doit faire échouer la publication tout de suite, avec une
 * `failureReason` lisible, plutôt que d'épuiser dix tentatives.
 */
export class ChannelError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { retryable: boolean; code: string; details?: unknown },
  ) {
    super(message);
    this.name = "ChannelError";
    this.retryable = options.retryable;
    this.code = options.code;
    this.details = options.details;
  }
}

export interface ChannelAdapter {
  capabilities(): ChannelCapabilities;
  checkQuota(): Promise<QuotaStatus>;
  fetchMetrics(remoteId: string): Promise<PublishMetrics>;
}
