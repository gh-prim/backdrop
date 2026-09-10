"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/platform-logo";
import { MediaThumb } from "@/components/media-thumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { reschedulePublicationAction } from "@/app/actions/publications";
import { cn } from "cn";

export type CalendarEvent = {
  id: string;
  name: string;
  caption: string;
  status: string;
  /** Un logo par canal: l'envoi est un seul objet, parti à plusieurs endroits. */
  platforms: ("INSTAGRAM" | "TELEGRAM" | "FANVUE")[];
  persona: string;
  destination: string;
  scheduledAt: string;
  starPrice: number | null;
  itemCount: number;
  coverVariantId: string | null;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  /** Verrou optimiste: renvoyé tel quel à la reprogrammation (7.4). */
  version: number;
};

type Scale = "day" | "week" | "month";

const SCALES: { value: Scale; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/** Journée ouvrée large: en dehors, une publication est rare et reste visible. */
const FIRST_HOUR = 6;
const LAST_HOUR = 24;
const HOUR_HEIGHT = 48;
const CHIP_HEIGHT = 44;

/** Deux envois plus proches que ça se recouvriraient à l'écran. */
const COLLISION_MINUTES = Math.round((CHIP_HEIGHT / HOUR_HEIGHT) * 60);

/**
 * Pas d'aimantation au dépôt.
 *
 * Une heure pleine serait trop grossier pour équilibrer une journée, la minute
 * trop fine pour être visée à la souris. Le quart d'heure est le compromis que
 * tous les agendas retiennent.
 */
const SNAP_MINUTES = 15;

/**
 * Calendrier des publications.
 *
 * Trois échelles, comme un agenda: le jour pour arbitrer un créneau à la
 * minute, la semaine pour équilibrer une programmation, le mois pour voir la
 * cadence d'ensemble.
 *
 * Cliquer un créneau vide ouvre le composeur avec l'heure déjà posée — c'est
 * le geste qui rend un calendrier utile: on y pense en termes de « quand »,
 * pas de « quoi ».
 */
export function CalendarView({ events }: { events: CalendarEvent[] }) {
  const router = useRouter();
  const [scale, setScale] = useState<Scale>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [opened, setOpened] = useState<CalendarEvent | null>(null);
  const [dragging, setDragging] = useState<CalendarEvent | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Déplacements affichés avant confirmation du serveur.
   *
   * Sans ça, la tuile reviendrait à sa place le temps de l'aller-retour, ce
   * qui donne l'impression que le geste a échoué. En cas de rejet — verrou de
   * version, publication déjà partie — l'entrée est retirée et la tuile
   * reprend sa place d'elle-même.
   */
  const [moved, setMoved] = useState<Record<string, string>>({});

  const days = useMemo(() => visibleDays(scale, anchor), [scale, anchor]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const raw of events) {
      const override = moved[raw.id];
      const event = override ? { ...raw, scheduledAt: override } : raw;
      const key = dayKey(new Date(event.scheduledAt));
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    }
    return map;
  }, [events, moved]);

  function compose(at: Date) {
    router.push(`/composer?at=${encodeURIComponent(at.toISOString())}`);
  }

  /**
   * Reprogramme un envoi déposé sur un nouveau créneau.
   *
   * Seules les publications `SCHEDULED` sont déplaçables: une publiée est
   * partie, et une échouée demande une décision, pas un glissement.
   */
  function move(event: CalendarEvent, to: Date) {
    if (event.status !== "SCHEDULED") return;

    const iso = to.toISOString();
    setMoved((current) => ({ ...current, [event.id]: iso }));

    const form = new FormData();
    form.set("publicationId", event.id);
    form.set("expectedVersion", String(event.version));
    form.set("caption", event.caption);
    // L'action attend une heure locale, comme le champ du composeur.
    form.set("scheduledAt", localInput(to));

    startTransition(async () => {
      const result = await reschedulePublicationAction(null, form);
      if (result.ok) {
        toast.success(
          `${event.name || "Publication"} moved to ${to.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
        );
        router.refresh();
      } else {
        setMoved((current) => {
          const next = { ...current };
          delete next[event.id];
          return next;
        });
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous"
            onClick={() => setAnchor(shift(anchor, scale, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next"
            onClick={() => setAnchor(shift(anchor, scale, 1))}
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            Today
          </Button>
        </div>

        <h2 className="text-sm font-medium">{rangeLabel(scale, days)}</h2>

        <div className="ml-auto flex gap-1 rounded-md border p-0.5 text-xs">
          {SCALES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              onClick={() => setScale(entry.value)}
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                scale === entry.value
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      {scale === "month" ? (
        <MonthGrid
          days={days}
          byDay={byDay}
          onCompose={compose}
          onOpen={setOpened}
          dragging={dragging}
          onDragStart={setDragging}
          onDrop={move}
        />
      ) : (
        <TimeGrid
          days={days}
          byDay={byDay}
          onCompose={compose}
          onOpen={setOpened}
          dragging={dragging}
          onDragStart={setDragging}
          onDrop={move}
        />
      )}

      <EventDialog event={opened} onClose={() => setOpened(null)} />
    </div>
  );
}

/* -------------------------------------------------------------- vues ---- */

function TimeGrid({
  days,
  byDay,
  onCompose,
  onOpen,
  dragging,
  onDragStart,
  onDrop,
}: {
  days: Date[];
  byDay: Map<string, CalendarEvent[]>;
  onCompose: (at: Date) => void;
  onOpen: (event: CalendarEvent) => void;
  dragging: CalendarEvent | null;
  onDragStart: (event: CalendarEvent | null) => void;
  onDrop: (event: CalendarEvent, to: Date) => void;
}) {
  const hours = Array.from(
    { length: LAST_HOUR - FIRST_HOUR },
    (_, index) => FIRST_HOUR + index,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <div
        className="grid shrink-0 border-b bg-muted/40"
        style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div />
        {days.map((day) => (
          <div key={day.toISOString()} className="border-l px-2 py-1.5 text-center">
            <p className="text-[11px] uppercase text-muted-foreground">
              {day.toLocaleDateString("en-GB", { weekday: "short" })}
            </p>
            <p
              className={cn(
                "text-sm font-medium",
                isToday(day) &&
                  "mx-auto flex size-6 items-center justify-center rounded-full bg-foreground text-background",
              )}
            >
              {day.getDate()}
            </p>
          </div>
        ))}
      </div>

      {/* Seule zone qui défile: l'axe des heures est une liste, et la règle du
          non-scroll vise les pages de détail (6.1). */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div>
            {hours.map((hour) => (
              <div
                key={hour}
                style={{ height: HOUR_HEIGHT }}
                className="relative border-b border-transparent pr-2 text-right"
              >
                <span className="absolute -top-2 right-2 text-[10px] text-muted-foreground">
                  {String(hour).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => (
            <div key={day.toISOString()} className="relative border-l">
              {hours.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  onClick={() => onCompose(at(day, hour))}
                  onDragOver={(domEvent) => {
                    // Sans ce preventDefault, le navigateur refuse le dépôt.
                    if (dragging) domEvent.preventDefault();
                  }}
                  onDrop={(domEvent) => {
                    if (!dragging) return;
                    domEvent.preventDefault();
                    const bounds = domEvent.currentTarget.getBoundingClientRect();
                    const ratio = (domEvent.clientY - bounds.top) / bounds.height;
                    const minutes =
                      Math.round((ratio * 60) / SNAP_MINUTES) * SNAP_MINUTES;
                    const target = at(day, hour);
                    target.setMinutes(Math.min(45, Math.max(0, minutes)));
                    onDrop(dragging, target);
                    onDragStart(null);
                  }}
                  style={{ height: HOUR_HEIGHT }}
                  aria-label={`Schedule at ${String(hour).padStart(2, "0")}:00`}
                  className={cn(
                    "block w-full border-b transition-colors",
                    dragging ? "hover:bg-primary/20" : "hover:bg-accent/40",
                  )}
                />
              ))}

              {layoutDay(byDay.get(dayKey(day)) ?? []).map((placed) => (
                <EventChip
                  key={placed.event.id}
                  event={placed.event}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                  overlap={{ index: placed.column, total: placed.columns }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventChip({
  event,
  onOpen,
  onDragStart,
  overlap,
}: {
  event: CalendarEvent;
  onOpen: (event: CalendarEvent) => void;
  onDragStart: (event: CalendarEvent | null) => void;
  overlap: { index: number; total: number };
}) {
  const date = new Date(event.scheduledAt);
  const minutes = (date.getHours() - FIRST_HOUR) * 60 + date.getMinutes();
  const top = (minutes / 60) * HOUR_HEIGHT;
  if (top < 0) return null;

  // Deux envois à la même heure ne doivent pas se recouvrir: on les répartit
  // en largeur plutôt que d'en cacher un.
  const width = 100 / overlap.total;

  // Seule une publication encore programmée se déplace: une publiée est
  // partie, une échouée demande une décision et pas un glissement.
  const movable = event.status === "SCHEDULED";

  return (
    <button
      type="button"
      draggable={movable}
      onDragStart={(domEvent) => {
        onDragStart(event);
        domEvent.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => onDragStart(null)}
      onClick={() => onOpen(event)}
      style={{
        top,
        left: `${overlap.index * width}%`,
        width: `calc(${width}% - 4px)`,
      }}
      className={cn(
        "absolute z-10 mx-0.5 flex h-11 flex-col justify-center gap-0.5 overflow-hidden rounded border-l-2 px-1.5 text-left text-[11px] transition-shadow hover:shadow-md",
        movable && "cursor-grab active:cursor-grabbing",
        statusClasses(event.status),
      )}
    >
      <span className="flex items-center gap-1">
        {event.platforms.map((platform) => (
          <PlatformLogo key={platform} platform={platform} className="size-3 shrink-0" />
        ))}
        <span className="truncate font-medium">{event.name || "Untitled"}</span>
      </span>
      <span className="truncate opacity-80">
        {time(date)}
        {event.starPrice !== null ? ` · ★${event.starPrice}` : ""}
      </span>
    </button>
  );
}

function MonthGrid({
  days,
  byDay,
  onCompose,
  onOpen,
  dragging,
  onDragStart,
  onDrop,
}: {
  days: Date[];
  byDay: Map<string, CalendarEvent[]>;
  onCompose: (at: Date) => void;
  onOpen: (event: CalendarEvent) => void;
  dragging: CalendarEvent | null;
  onDragStart: (event: CalendarEvent | null) => void;
  onDrop: (event: CalendarEvent, to: Date) => void;
}) {
  const month = days[Math.floor(days.length / 2)]?.getMonth();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <div className="grid shrink-0 grid-cols-7 border-b bg-muted/40">
        {days.slice(0, 7).map((day) => (
          <div
            key={day.toISOString()}
            className="px-2 py-1.5 text-center text-[11px] uppercase text-muted-foreground"
          >
            {day.toLocaleDateString("en-GB", { weekday: "short" })}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const dayEvents = byDay.get(dayKey(day)) ?? [];
          const outside = day.getMonth() !== month;

          return (
            <div
              key={day.toISOString()}
              onDragOver={(domEvent) => {
                if (dragging) domEvent.preventDefault();
              }}
              onDrop={(domEvent) => {
                if (!dragging) return;
                domEvent.preventDefault();
                // En vue mois on change de jour, pas d'heure: la cadence se
                // décide ici, l'heure exacte se règle en vue jour ou semaine.
                const source = new Date(dragging.scheduledAt);
                const target = startOfDay(day);
                target.setHours(source.getHours(), source.getMinutes());
                onDrop(dragging, target);
                onDragStart(null);
              }}
              className={cn(
                "group/day relative min-h-0 border-b border-l p-1 first:border-l-0",
                outside && "bg-muted/20",
                dragging && "hover:bg-primary/10",
              )}
            >
              {/* Toute la case est cliquable, pas seulement le numéro: c'est
                  le geste attendu d'un agenda. Le bouton est en fond, les
                  événements passent au-dessus. */}
              <button
                type="button"
                onClick={() => onCompose(at(day, 12))}
                aria-label={`Schedule on ${day.toDateString()}`}
                className="absolute inset-0 transition-colors hover:bg-accent/30"
              />

              <div className="pointer-events-none relative mb-1 px-1">
                <span
                  className={cn(
                    "text-xs",
                    outside ? "text-muted-foreground/60" : "text-muted-foreground",
                    isToday(day) &&
                      "flex size-5 items-center justify-center rounded-full bg-foreground text-background",
                  )}
                >
                  {day.getDate()}
                </span>
              </div>

              <div className="relative space-y-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    draggable={event.status === "SCHEDULED"}
                    onDragStart={(domEvent) => {
                      onDragStart(event);
                      domEvent.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => onDragStart(null)}
                    onClick={() => onOpen(event)}
                    className={cn(
                      "flex w-full items-center gap-1 truncate rounded border-l-2 px-1 py-0.5 text-left text-[10px]",
                      event.status === "SCHEDULED" && "cursor-grab active:cursor-grabbing",
                      statusClasses(event.status),
                    )}
                  >
                    {event.platforms.map((platform) => (
                      <PlatformLogo
                        key={platform}
                        platform={platform}
                        className="size-2.5 shrink-0"
                      />
                    ))}
                    <span className="truncate">
                      {time(new Date(event.scheduledAt))} {event.name || "Untitled"}
                    </span>
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <p className="pointer-events-none px-1 text-[10px] text-muted-foreground">
                    +{dayEvents.length - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventDialog({
  event,
  onClose,
}: {
  event: CalendarEvent | null;
  onClose: () => void;
}) {
  const router = useRouter();

  return (
    <Dialog open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {event && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {event.platforms.map((platform) => (
                  <PlatformLogo key={platform} platform={platform} className="size-5" />
                ))}
                {event.name || "Untitled"}
              </DialogTitle>
              <DialogDescription>
                {new Date(event.scheduledAt).toLocaleString("en-GB", {
                  dateStyle: "full",
                  timeStyle: "short",
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex gap-3">
              {event.coverVariantId && (
                <MediaThumb
                  variantId={event.coverVariantId}
                  rating={event.rating}
                  className="aspect-[4/5] w-24 shrink-0"
                />
              )}

              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    {event.status.toLowerCase()}
                  </Badge>
                  {event.itemCount > 1 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {event.itemCount} media
                    </Badge>
                  )}
                  {event.starPrice !== null && (
                    <Badge className="h-5 gap-1 bg-amber-500/90 px-1.5 text-[10px] text-amber-950">
                      <Star className="size-3" />
                      {event.starPrice}
                    </Badge>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {event.persona} · {event.destination}
                </p>

                {event.caption && (
                  <p className="line-clamp-4 text-xs text-foreground/70">
                    {event.caption}
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                className="h-8"
                onClick={() => router.push("/publications")}
              >
                Open in publications
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------ dates ---- */

/**
 * Répartit en colonnes les seuls envois qui se chevauchent.
 *
 * Diviser la largeur entre tous les envois du jour réduirait à des lamelles
 * illisibles sept publications espacées de plusieurs heures. On ne partage
 * donc la largeur qu'à l'intérieur d'une grappe: une suite d'envois dont
 * chacun commence avant que le précédent n'ait fini de s'afficher.
 */
function layoutDay(
  events: CalendarEvent[],
): { event: CalendarEvent; column: number; columns: number }[] {
  const placed: { event: CalendarEvent; column: number; columns: number }[] = [];
  let cluster: CalendarEvent[] = [];

  const flush = () => {
    cluster.forEach((event, index) =>
      placed.push({ event, column: index, columns: cluster.length }),
    );
    cluster = [];
  };

  for (const event of events) {
    const last = cluster[cluster.length - 1];
    const apart = last
      ? (new Date(event.scheduledAt).getTime() -
          new Date(last.scheduledAt).getTime()) /
        60000
      : Infinity;

    if (last && apart < COLLISION_MINUTES) cluster.push(event);
    else {
      flush();
      cluster = [event];
    }
  }
  flush();

  return placed;
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function at(day: Date, hour: number) {
  const copy = startOfDay(day);
  copy.setHours(hour);
  return copy;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isToday(date: Date) {
  return dayKey(date) === dayKey(new Date());
}

/**
 * Heure locale au format que l'action attend.
 *
 * Surtout pas `toISOString()`, qui renvoie de l'UTC: l'action le relit comme
 * une heure locale et décale l'échéance — la méprise qui a déjà envoyé une
 * publication une heure trop tard.
 */
function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function time(date: Date) {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Lundi comme premier jour: c'est la semaine telle qu'on la planifie ici. */
function startOfWeek(date: Date) {
  const copy = startOfDay(date);
  const shiftBack = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - shiftBack);
  return copy;
}

function visibleDays(scale: Scale, anchor: Date): Date[] {
  if (scale === "day") return [startOfDay(anchor)];

  if (scale === "week") {
    const first = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(first, index));
  }

  // Six semaines pleines: la grille garde la même hauteur d'un mois à l'autre,
  // au lieu de sauter entre cinq et six lignes.
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const first = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function shift(anchor: Date, scale: Scale, direction: number) {
  if (scale === "day") return addDays(anchor, direction);
  if (scale === "week") return addDays(anchor, 7 * direction);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

function rangeLabel(scale: Scale, days: Date[]) {
  if (scale === "day") {
    return days[0].toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  if (scale === "week") {
    const first = days[0];
    const last = days[days.length - 1];
    const sameMonth = first.getMonth() === last.getMonth();
    return `${first.getDate()} ${sameMonth ? "" : first.toLocaleDateString("en-GB", { month: "short" }) + " "}– ${last.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  }
  const middle = days[Math.floor(days.length / 2)];
  return middle.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function statusClasses(status: string) {
  if (status === "FAILED" || status === "MISSED") {
    return "border-destructive bg-destructive/15 text-destructive-foreground";
  }
  if (status === "PUBLISHED") {
    return "border-emerald-500 bg-emerald-500/15";
  }
  if (status === "DRY_RUN") {
    return "border-sky-400 bg-sky-400/15";
  }
  if (status === "PUBLISHING") {
    return "border-sky-500 bg-sky-500/15 animate-pulse";
  }
  return "border-foreground/40 bg-muted";
}
