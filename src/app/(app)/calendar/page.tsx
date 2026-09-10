import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listPublications } from "@/lib/publications";
import { FixedHeightPage } from "@/components/tabs-shell";
import { PageHeader } from "@/components/page-header";
import { CalendarView } from "./calendar-view";

const RATINGS = ["SFW", "SUGGESTIVE", "NSFW"] as const;

export default async function CalendarPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const publications = await listPublications(
    ctx,
    selectedId === ALL_PERSONAS ? undefined : selectedId,
  );

  return (
    <FixedHeightPage>
      <PageHeader
        title="Calendar"
        description="Click an empty slot to schedule; the composer opens on that time."
      />

      <CalendarView
        events={publications.map((publication) => ({
          id: publication.id,
          name: publication.name,
          caption: publication.copy,
          status: publication.status,
          platform: publication.channelAccount.platform,
          persona: publication.channelAccount.persona.name,
          destination:
            publication.targetLabel ??
            `${publication.channelAccount.platform.charAt(0)}${publication.channelAccount.platform.slice(1).toLowerCase()} · ${publication.channelAccount.persona.name}`,
          scheduledAt: publication.scheduledAt.toISOString(),
          version: publication.version,
          starPrice: publication.starPrice,
          itemCount: publication.items.length,
          coverVariantId: publication.items[0]?.variant.id ?? null,
          // Le rating affiché est le plus élevé du lot: flouter selon la
          // couverture laisserait passer un média sensible derrière une
          // première image anodine.
          rating: publication.items.reduce<"SFW" | "SUGGESTIVE" | "NSFW">(
            (max, item) =>
              RATINGS.indexOf(item.variant.asset.rating) > RATINGS.indexOf(max)
                ? item.variant.asset.rating
                : max,
            "SFW",
          ),
        }))}
      />
    </FixedHeightPage>
  );
}
