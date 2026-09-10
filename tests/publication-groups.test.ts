import { describe, expect, it } from "vitest";
import { groupPublications } from "@/lib/publication-groups";

/**
 * Un envoi multi-canal vaut plusieurs publications en base — un échec sur l'un
 * ne doit pas emporter les autres — mais un seul objet à l'écran. Ces tests
 * fixent ce que le regroupement doit préserver au passage.
 */

let counter = 0;

function row(overrides: Partial<Parameters<typeof groupPublications>[0][number]> = {}) {
  counter += 1;
  return {
    id: `pub-${counter}`,
    groupId: "envoi-1",
    name: "Séance yoga",
    kind: "SINGLE",
    copy: "légende",
    status: "PUBLISHED",
    scheduledAt: new Date("2026-09-12T10:00:00Z"),
    publishedAt: null,
    remoteId: null,
    failureReason: null,
    version: 0,
    starPrice: null,
    targetLabel: null,
    archivedAt: null,
    dryRun: false,
    createdBy: { name: "Opérateur" },
    channelAccount: {
      platform: "INSTAGRAM",
      persona: { name: "Carolina" },
    },
    items: [{ variant: { id: "var-1", asset: { rating: "SFW" } } }],
    ...overrides,
  };
}

describe("groupPublications", () => {
  it("réunit les publications d'un même envoi en un seul objet", () => {
    const groups = groupPublications([
      row({ channelAccount: { platform: "INSTAGRAM", persona: { name: "Carolina" } } }),
      row({ channelAccount: { platform: "TELEGRAM", persona: { name: "Carolina" } } }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].legs.map((leg) => leg.platform)).toEqual([
      "INSTAGRAM",
      "TELEGRAM",
    ]);
  });

  it("ne réunit jamais deux envois distincts portant le même nom", () => {
    // Le regroupement passe par groupId et non par le libellé: deux envois
    // homonymes annulés ensemble seraient une catastrophe silencieuse.
    const groups = groupPublications([
      row({ groupId: "envoi-1" }),
      row({ groupId: "envoi-2" }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("retient l'état le plus préoccupant comme état d'ensemble", () => {
    // Un envoi à moitié échoué se lit comme échoué: c'est ce qui réclame une
    // action. Le détail par canal reste porté par `legs`.
    const groups = groupPublications([
      row({ status: "PUBLISHED" }),
      row({
        status: "FAILED",
        failureReason: "Quota atteint.",
        channelAccount: { platform: "TELEGRAM", persona: { name: "Carolina" } },
      }),
    ]);

    expect(groups[0].status).toBe("FAILED");
    expect(groups[0].legs.map((leg) => leg.status).sort()).toEqual([
      "FAILED",
      "PUBLISHED",
    ]);
  });

  it("retient le rating le plus élevé du lot", () => {
    // Flouter selon la couverture laisserait passer un média sensible caché
    // derrière une première image anodine.
    const groups = groupPublications([
      row({
        items: [
          { variant: { id: "a", asset: { rating: "SFW" } } },
          { variant: { id: "b", asset: { rating: "NSFW" } } },
        ],
      }),
    ]);

    expect(groups[0].rating).toBe("NSFW");
    expect(groups[0].coverVariantId).toBe("a");
  });

  it("nomme la destination Telegram et déduit celle des autres", () => {
    const groups = groupPublications([
      row({
        targetLabel: "carolina dev",
        channelAccount: { platform: "TELEGRAM", persona: { name: "Carolina" } },
      }),
      row({ channelAccount: { platform: "INSTAGRAM", persona: { name: "Carolina" } } }),
    ]);

    const destinations = groups[0].legs.map((leg) => leg.destination);
    expect(destinations).toContain("carolina dev");
    expect(destinations).toContain("Instagram · Carolina");
  });
});
