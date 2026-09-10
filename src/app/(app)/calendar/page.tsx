import { requireOrgContext } from "@/lib/session";
import { listPersonas, getSelectedPersonaId } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listPublications } from "@/lib/publications";
import { groupPublications } from "@/lib/publication-groups";
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
        events={groupPublications(publications).map((group) => ({
          id: group.id,
          name: group.name,
          caption: group.caption,
          status: group.status,
          platforms: group.legs.map((leg) => leg.platform),
          persona: group.persona,
          destination: group.legs.map((leg) => leg.destination).join(", "),
          scheduledAt: group.scheduledAt.toISOString(),
          version: group.version,
          starPrice: group.legs.find((leg) => leg.starPrice !== null)?.starPrice ?? null,
          itemCount: group.itemCount,
          coverVariantId: group.coverVariantId,
          rating: group.rating,
        }))}
      />
    </FixedHeightPage>
  );
}
