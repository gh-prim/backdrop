import { requireOrgContext } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";

export default async function CalendarPage() {
  await requireOrgContext();
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Calendrier</h1>
      <Card>
        <CardContent className="space-y-2 py-8 text-center text-sm text-muted-foreground">
          <p>Vue temporelle tous canaux, par persona ou globale.</p>
          <p className="text-xs">
            Arrive en phase 1 avec les premières publications programmées. L&apos;horloge
            est tenue par l&apos;application, sur tous les canaux (spec 7.6).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
