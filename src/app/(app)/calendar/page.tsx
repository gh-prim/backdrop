import { requireOrgContext } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";

export default async function CalendarPage() {
  await requireOrgContext();
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Calendar</h1>
      <Card>
        <CardContent className="space-y-2 py-8 text-center text-sm text-muted-foreground">
          <p>Timeline across every channel, per persona or organization-wide.</p>
          <p className="text-xs">
            Coming with the first scheduled publications. The clock stays on the
            application side, for every channel (spec 7.6).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
