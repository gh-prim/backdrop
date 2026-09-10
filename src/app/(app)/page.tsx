import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Images,
  Plus,
  Star,
} from "lucide-react";
import { requireOrgContext } from "@/lib/session";
import { getSelectedPersonaId, listPersonas } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { listChannelStatus } from "@/lib/channels";
import { listPublications } from "@/lib/publications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaThumb } from "@/components/media-thumb";
import { PlatformLogo } from "@/components/platform-logo";
import { PageHeader } from "@/components/page-header";
import { cn } from "cn";

const RATINGS = ["SFW", "SUGGESTIVE", "NSFW"] as const;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default async function DashboardPage() {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  const scoped =
    selectedId === ALL_PERSONAS ? personas : personas.filter((p) => p.id === selectedId);

  // Projection sûre: aucun credential ne descend jusqu'au client (9.7).
  const channels = await listChannelStatus(ctx);
  const publications = await listPublications(
    ctx,
    selectedId === ALL_PERSONAS ? undefined : selectedId,
  );

  const now = Date.now();

  const upcoming = publications
    .filter((p) => p.status === "SCHEDULED" || p.status === "PUBLISHING")
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  // Deux files distinctes: un échec est un incident, une publication manquée
  // est une décision en attente (7.6).
  const failed = publications.filter((p) => p.status === "FAILED");
  const missed = publications.filter((p) => p.status === "MISSED");
  const attention = [...missed, ...failed];

  const publishedThisWeek = publications.filter(
    (p) => p.publishedAt && now - p.publishedAt.getTime() < WEEK_MS,
  );

  const recent = publications
    .filter((p) => p.publishedAt)
    .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        title={selectedId === ALL_PERSONAS ? "All personas" : (scoped[0]?.name ?? "")}
        description={
          upcoming[0]
            ? `Next send ${relative(upcoming[0].scheduledAt, now)}`
            : "Nothing scheduled."
        }
        actions={
          // `nativeButton={false}`: le rendu est un <a>, et prétendre le
          // contraire retire à Base UI la sémantique native — ce qui casse la
          // navigation clavier et ce que les lecteurs d'écran annoncent.
          <Button size="sm" nativeButton={false} render={<Link href="/composer" />}>
            <Plus />
            New publication
          </Button>
        }
      />

      {/* Quatre chiffres, et un seul appelle une action: c'est lui qui porte
          la couleur. Le reste informe sans réclamer. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<CalendarClock className="size-4" />}
          value={upcoming.length}
          label="scheduled"
          href="/calendar"
        />
        <Stat
          icon={<CheckCircle2 className="size-4" />}
          value={publishedThisWeek.length}
          label="published this week"
          href="/publications"
        />
        <Stat
          icon={<AlertTriangle className="size-4" />}
          value={attention.length}
          label={missed.length > 0 ? "need a call" : "failed"}
          href="/publications"
          alarming={attention.length > 0}
        />
        <Stat
          icon={<Images className="size-4" />}
          value={channels.length}
          label="channels connected"
          href="/settings"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Next up</h2>
            <Link href="/calendar" className="text-xs text-muted-foreground hover:underline">
              Open calendar
            </Link>
          </div>

          {upcoming.length === 0 ? (
            <EmptyPanel>
              Nothing scheduled. The composer, or a click on a calendar slot, starts one.
            </EmptyPanel>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {upcoming.slice(0, 6).map((publication) => (
                <UpcomingTile
                  key={publication.id}
                  publication={publication}
                  now={now}
                />
              ))}
            </div>
          )}

          {recent.length > 0 && (
            <>
              <h2 className="pt-2 text-sm font-medium">Recently published</h2>
              <div className="flex flex-wrap gap-2">
                {recent.map((publication) => (
                  <Link
                    key={publication.id}
                    href="/publications"
                    className="group/recent relative"
                    title={publication.name || "Untitled"}
                  >
                    {publication.items[0] ? (
                      <MediaThumb
                        variantId={publication.items[0].variant.id}
                        rating={maxRating(publication.items)}
                        className="size-16"
                      />
                    ) : (
                      <span className="flex size-16 items-center justify-center rounded-md border text-[10px] text-muted-foreground">
                        —
                      </span>
                    )}
                    <span className="absolute -bottom-1 -right-1 rounded bg-background p-0.5 ring-1 ring-border">
                      <PlatformLogo
                        platform={publication.channelAccount.platform}
                        className="size-3"
                      />
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>

        <aside className="space-y-4">
          {attention.length > 0 && (
            <section className="space-y-2 rounded-lg border border-destructive/40 p-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                Needs attention
              </h2>
              <ul className="space-y-2">
                {attention.slice(0, 4).map((publication) => (
                  <li key={publication.id} className="text-xs">
                    <Link href="/publications" className="font-medium hover:underline">
                      {publication.name || "Untitled"}
                    </Link>
                    <p className="text-muted-foreground">
                      {publication.status === "MISSED"
                        ? "Missed its window — waiting for your call."
                        : (publication.failureReason ?? "Failed.")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2 rounded-lg border p-3">
            <h2 className="text-sm font-medium">Channels</h2>
            {channels.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                None connected. An owner adds one from Settings.
              </p>
            ) : (
              <ul className="space-y-2">
                {channels.map((channel) => (
                  <li key={channel.id} className="flex items-center gap-2 text-xs">
                    <PlatformLogo platform={channel.platform} className="size-4 shrink-0" />
                    <span className="truncate">
                      {personas.find((p) => p.id === channel.personaId)?.name ?? "—"}
                    </span>
                    <ChannelState state={channel.state} days={channel.expiresInDays} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ pièces ---- */

function Stat({
  icon,
  value,
  label,
  href,
  alarming = false,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  href: string;
  alarming?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40",
        alarming && "border-destructive/50",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md bg-muted",
          alarming && "bg-destructive/15 text-destructive",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-xl font-bold leading-none", alarming && "text-destructive")}>
          {value}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </Link>
  );
}

type PublicationRow = Awaited<ReturnType<typeof listPublications>>[number];

function UpcomingTile({
  publication,
  now,
}: {
  publication: PublicationRow;
  now: number;
}) {
  const cover = publication.items[0];
  const sending = publication.status === "PUBLISHING";

  return (
    <Link
      href="/calendar"
      className="group/next flex gap-3 rounded-lg border p-2 transition-colors hover:bg-accent/30"
    >
      {cover ? (
        <MediaThumb
          variantId={cover.variant.id}
          rating={maxRating(publication.items)}
          className="size-16 shrink-0"
        />
      ) : (
        <span className="flex size-16 shrink-0 items-center justify-center rounded-md border text-[10px] text-muted-foreground">
          —
        </span>
      )}

      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-1.5">
          <PlatformLogo platform={publication.channelAccount.platform} className="size-3.5" />
          <span className="truncate text-sm font-medium">
            {publication.name || "Untitled"}
          </span>
        </span>

        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          {sending ? "sending now" : relative(publication.scheduledAt, now)}
        </span>

        <span className="flex flex-wrap gap-1">
          {publication.items.length > 1 && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
              {publication.items.length} media
            </Badge>
          )}
          {publication.starPrice !== null && (
            <Badge className="h-4 gap-0.5 bg-amber-500/90 px-1 text-[9px] text-amber-950">
              <Star className="size-2.5" />
              {publication.starPrice}
            </Badge>
          )}
          {publication.targetLabel && (
            <Badge variant="outline" className="h-4 max-w-32 truncate px-1 text-[9px]">
              {publication.targetLabel}
            </Badge>
          )}
        </span>
      </span>
    </Link>
  );
}

function ChannelState({ state, days }: { state: string; days: number | null }) {
  if (state === "expired") {
    return (
      <Badge variant="destructive" className="ml-auto h-4 px-1 text-[9px]">
        expired
      </Badge>
    );
  }
  if (state === "expiring") {
    return (
      <Badge className="ml-auto h-4 bg-amber-500/15 px-1 text-[9px] text-amber-700 dark:text-amber-400">
        {days} d left
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="ml-auto h-4 px-1 text-[9px]">
      ok
    </Badge>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function maxRating(items: PublicationRow["items"]) {
  return items.reduce<"SFW" | "SUGGESTIVE" | "NSFW">(
    (max, item) =>
      RATINGS.indexOf(item.variant.asset.rating) > RATINGS.indexOf(max)
        ? item.variant.asset.rating
        : max,
    "SFW",
  );
}

/**
 * Distance en clair plutôt qu'une date.
 *
 * « dans 3 h » se saisit sans calcul mental, là où « 12/09 11:30 » oblige à
 * comparer avec l'heure qu'il est. C'est la question qu'on se pose devant un
 * tableau de bord: est-ce imminent ?
 */
function relative(date: Date, now: number) {
  const minutes = Math.round((date.getTime() - now) / 60000);
  const past = minutes < 0;
  const absolute = Math.abs(minutes);

  const text =
    absolute < 60
      ? `${absolute} min`
      : absolute < 60 * 36
        ? `${Math.round(absolute / 60)} h`
        : `${Math.round(absolute / (60 * 24))} d`;

  return past ? `${text} ago` : `in ${text}`;
}
