import "server-only";

type Platform = "INSTAGRAM" | "TELEGRAM" | "FANVUE";
type Status = string;

/** Un canal d'un envoi, avec son sort propre. */
export type GroupLeg = {
  publicationId: string;
  platform: Platform;
  status: Status;
  remoteId: string | null;
  failureReason: string | null;
  destination: string;
  starPrice: number | null;
};

/**
 * Un envoi tel que l'opérateur l'a composé.
 *
 * En base il vaut une publication par canal — un échec sur l'un ne doit pas
 * emporter les autres (section 3). Mais à l'écran c'est un seul objet: on l'a
 * composé d'un geste, on le programme, l'annule et l'archive d'un geste.
 */
export type PublicationGroup = {
  groupId: string;
  /** Publication de référence pour les actions; toutes partagent le groupe. */
  id: string;
  name: string;
  kind: string;
  caption: string;
  scheduledAt: Date;
  publishedAt: Date | null;
  version: number;
  author: string;
  persona: string;
  archived: boolean;
  dryRun: boolean;
  itemCount: number;
  coverVariantId: string | null;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  legs: GroupLeg[];
  /** État d'ensemble: le plus préoccupant de ses canaux. */
  status: Status;
};

const RATINGS = ["SFW", "SUGGESTIVE", "NSFW"] as const;

/**
 * Gravité décroissante.
 *
 * Un envoi partiellement échoué se lit comme échoué: c'est ce qui réclame une
 * action. Le détail par canal reste visible sur la tuile, donc rien n'est
 * masqué — seule la tête de gondole prend le pire.
 */
const SEVERITY: Status[] = [
  "FAILED",
  "MISSED",
  "PUBLISHING",
  "SCHEDULED",
  "DRAFT",
  "DRY_RUN",
  "PUBLISHED",
];

type Row = {
  id: string;
  groupId: string;
  name: string;
  kind: string;
  copy: string;
  status: string;
  scheduledAt: Date;
  publishedAt: Date | null;
  remoteId: string | null;
  failureReason: string | null;
  version: number;
  starPrice: number | null;
  targetLabel: string | null;
  archivedAt: Date | null;
  dryRun: boolean;
  createdBy: { name: string };
  channelAccount: {
    platform: string;
    persona: { name: string };
  };
  items: { variant: { id: string; asset: { rating: string } } }[];
};

export function groupPublications(rows: Row[]): PublicationGroup[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const bucket = groups.get(row.groupId);
    if (bucket) bucket.push(row);
    else groups.set(row.groupId, [row]);
  }

  return [...groups.values()].map((siblings) => {
    // La référence porte les champs communs; ils sont identiques par
    // construction, une publication par canal d'un même geste.
    const first = siblings[0];

    const legs: GroupLeg[] = siblings.map((row) => ({
      publicationId: row.id,
      platform: row.channelAccount.platform as Platform,
      status: row.status,
      remoteId: row.remoteId,
      failureReason: row.failureReason,
      destination:
        row.targetLabel ??
        `${row.channelAccount.platform.charAt(0)}${row.channelAccount.platform.slice(1).toLowerCase()} · ${row.channelAccount.persona.name}`,
      starPrice: row.starPrice,
    }));

    legs.sort((a, b) => a.platform.localeCompare(b.platform));

    const status =
      SEVERITY.find((candidate) => legs.some((leg) => leg.status === candidate)) ??
      first.status;

    return {
      groupId: first.groupId,
      id: first.id,
      name: first.name,
      kind: first.kind,
      caption: first.copy,
      scheduledAt: first.scheduledAt,
      publishedAt:
        siblings.map((row) => row.publishedAt).find((value) => value !== null) ?? null,
      version: first.version,
      author: first.createdBy.name,
      persona: first.channelAccount.persona.name,
      archived: first.archivedAt !== null,
      dryRun: first.dryRun,
      itemCount: first.items.length,
      coverVariantId: first.items[0]?.variant.id ?? null,
      // Le plus élevé du lot: flouter selon la couverture laisserait passer un
      // média sensible caché derrière une première image anodine.
      rating: first.items.reduce<"SFW" | "SUGGESTIVE" | "NSFW">(
        (max, item) =>
          RATINGS.indexOf(item.variant.asset.rating as "SFW") > RATINGS.indexOf(max)
            ? (item.variant.asset.rating as "SFW")
            : max,
        "SFW",
      ),
      legs,
      status,
    };
  });
}
