"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, AlertTriangle, Images, Search, Star, X } from "lucide-react";
import { toast } from "sonner";
import { useLocalPreference } from "@/lib/use-local-preference";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaThumb } from "@/components/media-thumb";
import { PlatformLogo } from "@/components/platform-logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  archivePublicationAction,
  cancelPublicationAction,
  publishMissedNowAction,
  reschedulePublicationAction,
  unarchivePublicationAction,
  type ActionResult,
} from "@/app/actions/publications";
import { cn } from "cn";

export type PublicationCard = {
  id: string;
  name: string;
  kind: string;
  status: string;
  caption: string;
  scheduledAt: string;
  publishedAt: string | null;
  remoteId: string | null;
  failureReason: string | null;
  version: number;
  author: string;
  platform: "INSTAGRAM" | "TELEGRAM" | "FANVUE";
  persona: string;
  itemCount: number;
  rating: "SFW" | "SUGGESTIVE" | "NSFW";
  /** Première variante: c'est elle qui rend la publication reconnaissable. */
  coverVariantId: string | null;
  coverRatio: string | null;
  starPrice: number | null;
  targetLabel: string | null;
  /** Où l'envoi est parti: channel Telegram nommé, ou compte de plateforme. */
  destination: string;
  archived: boolean;
};

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;
const STATUSES = ["All", "SCHEDULED", "PUBLISHED", "FAILED", "MISSED"] as const;

/**
 * Publications en tuiles.
 *
 * Le tableau qui précédait n'affichait aucune image, alors qu'une publication
 * se reconnaît d'abord à son visuel — pas à son nom ni à son horodatage. La
 * vignette devient donc l'ancre de la tuile, et le reste s'organise autour.
 *
 * La grille défile: c'est une collection, et la règle du non-scroll vise les
 * pages de détail (6.1).
 */
export function PublicationsGrid({
  cards,
  showingArchived,
}: {
  cards: PublicationCard[];
  showingArchived: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PublicationCard | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("All");
  const [destination, setDestination] = useState("all");

  // La densité est une préférence d'opérateur, pas un réglage de session:
  // elle survit à la navigation et aux rechargements, comme en bibliothèque.
  const [columns, setColumns] = useLocalPreference(
    "backdrop.publications.columns",
    3,
    (raw) => Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Number(raw) || 3)),
  );

  // Les destinations viennent de ce qui a réellement été envoyé, pas d'une
  // liste figée: un channel ajouté hier doit y figurer sans rien changer ici.
  const destinations = useMemo(
    () => Array.from(new Set(cards.map((card) => card.destination))).sort(),
    [cards],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (status !== "All" && card.status !== status) return false;
      if (destination !== "all" && card.destination !== destination) return false;
      if (!needle) return true;
      return [card.name, card.caption, card.persona, card.destination, card.author]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [cards, query, status, destination]);

  const activeFilters =
    (status !== "All" ? 1 : 0) +
    (destination !== "all" ? 1 : 0) +
    (query.trim() ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, caption, persona, destination"
            className="h-8 pl-8"
          />
        </div>

        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          Columns
          <input
            type="range"
            min={MIN_COLUMNS}
            max={MAX_COLUMNS}
            value={columns}
            onChange={(event) => setColumns(Number(event.target.value))}
            className="w-28"
          />
          <span className="w-3 font-medium text-foreground">{columns}</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-md border p-0.5 text-xs">
          {STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                "rounded px-2 py-1 transition-colors",
                status === value
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "All" ? "All" : value.toLowerCase()}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Sent to
          <select
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            className="h-8 rounded-md border bg-transparent px-2 text-sm text-foreground"
          >
            <option value="all">Anywhere</option>
            {destinations.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>

        {/* L'archive est un autre jeu de données, pas un filtre du même:
            elle se demande au serveur, d'où le passage par l'URL. */}
        <Button
          type="button"
          variant={showingArchived ? "secondary" : "ghost"}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() =>
            router.push(showingArchived ? "/publications" : "/publications?archived=1")
          }
        >
          <Archive className="size-3.5" />
          {showingArchived ? "Viewing archive" : "Archive"}
        </Button>

        {activeFilters > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => {
              setQuery("");
              setStatus("All");
              setDestination("all");
            }}
          >
            <X className="size-3" />
            Clear
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {cards.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No publication matches these filters.
        </p>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {filtered.map((card) => (
            <PublicationTile
              key={card.id}
              card={card}
              dense={columns >= 5}
              onEdit={() => setEditing(card)}
            />
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reschedule</DialogTitle>
            <DialogDescription>
              {editing?.name || "Untitled"} — {editing?.persona}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <RescheduleForm card={editing} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PublicationTile({
  card,
  dense,
  onEdit,
}: {
  card: PublicationCard;
  dense: boolean;
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const failed = card.status === "FAILED" || card.status === "MISSED";

  return (
    <article
      className={cn(
        "group/tile flex flex-col overflow-hidden rounded-lg border bg-card",
        failed && "border-destructive/40",
      )}
    >
      {/* Le format est porté par la vignette elle-même, pas par un parent:
          combiner `aspect-ratio` sur le conteneur et `h-full` sur l'enfant
          crée une dépendance circulaire que la grille tranche en étirant. */}
      <div className="relative">
        {card.coverVariantId ? (
          <MediaThumb
            variantId={card.coverVariantId}
            rating={card.rating}
            className="aspect-[4/5] w-full rounded-none border-0"
          />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center text-xs text-muted-foreground">
            no media
          </div>
        )}

        {/* Superposées plutôt que placées sous l'image: la plateforme et
            l'état doivent se lire sans quitter la vignette des yeux. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <span className="rounded-md bg-background/85 p-1 backdrop-blur-sm">
            <PlatformLogo platform={card.platform} className="size-4" />
          </span>
          <StatusBadge status={card.status} />
        </div>

        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
          {card.itemCount > 1 && (
            <Badge
              variant="secondary"
              className="h-5 gap-1 bg-background/85 px-1.5 text-[10px] backdrop-blur-sm"
            >
              <Images className="size-3" />
              {card.itemCount}
            </Badge>
          )}
          {card.starPrice !== null && (
            <Badge className="ml-auto h-5 gap-1 bg-amber-500/90 px-1.5 text-[10px] text-amber-950">
              <Star className="size-3" />
              {card.starPrice}
            </Badge>
          )}
        </div>
      </div>

      <div className={cn("flex min-h-0 flex-1 flex-col gap-1.5", dense ? "p-2" : "p-3")}>
        <p className="truncate text-sm font-medium">{card.name || "Untitled"}</p>

        <p className="text-xs text-muted-foreground">
          {card.persona}
          {card.targetLabel ? ` · ${card.targetLabel}` : ""}
        </p>

        <p className="text-xs text-muted-foreground">
          {formatDate(card.publishedAt ?? card.scheduledAt)}
          {card.publishedAt ? "" : " · scheduled"}
        </p>

        {card.caption && !dense && (
          <p className="line-clamp-2 text-xs text-foreground/70">{card.caption}</p>
        )}

        {card.failureReason && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span className="line-clamp-2">{card.failureReason}</span>
          </p>
        )}

        <div className="mt-auto flex items-center gap-1 pt-2">
          {card.status === "SCHEDULED" && (
            <>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onEdit}>
                Reschedule
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={pending}
                onClick={() => startTransition(() => void cancelPublicationAction(card.id))}
              >
                Cancel
              </Button>
            </>
          )}

          {card.status === "MISSED" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={pending}
              onClick={() => startTransition(() => void publishMissedNowAction(card.id))}
            >
              Publish now
            </Button>
          )}

          {card.remoteId && (
            <span className="truncate text-[10px] text-muted-foreground">
              {card.remoteId}
            </span>
          )}

          <ArchiveButton card={card} className="ml-auto" />
        </div>
      </div>
    </article>
  );
}

/**
 * Ranger ou remettre une publication.
 *
 * Absent tant qu'elle n'est pas terminée: masquer un envoi encore à venir
 * donnerait le sentiment de l'avoir annulé, alors qu'il partirait quand même.
 */
function ArchiveButton({
  card,
  className,
}: {
  card: PublicationCard;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const terminal = ["PUBLISHED", "FAILED", "MISSED"].includes(card.status);
  if (!terminal) return null;

  const label = card.archived ? "Restore" : "Archive";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={pending}
      className={cn("opacity-0 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100", className)}
      onClick={() =>
        startTransition(async () => {
          const result = card.archived
            ? await unarchivePublicationAction(card.id)
            : await archivePublicationAction(card.id);
          if (result.ok) toast.success(result.message ?? label);
          else toast.error(result.error);
        })
      }
    >
      {card.archived ? <ArchiveRestore /> : <Archive />}
    </Button>
  );
}

function StatusBadge({ status }: { status: string }) {
  // Un échec doit se voir d'un coup d'œil dans une grille; le reste s'efface.
  if (status === "FAILED" || status === "MISSED") {
    return (
      <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
        {status.toLowerCase()}
      </Badge>
    );
  }
  if (status === "PUBLISHING") {
    return (
      <Badge className="h-5 animate-pulse px-1.5 text-[10px]">sending…</Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="h-5 bg-background/85 px-1.5 text-[10px] backdrop-blur-sm"
    >
      {status.toLowerCase()}
    </Badge>
  );
}

function RescheduleForm({
  card,
  onDone,
}: {
  card: PublicationCard;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await reschedulePublicationAction(prev, formData);
      if (result.ok) onDone();
      return result;
    },
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="publicationId" value={card.id} />
      {/* Verrou optimiste: la version lue à l'affichage est renvoyée telle
          quelle. Si quelqu'un est passé entre-temps, l'écriture est rejetée. */}
      <input type="hidden" name="expectedVersion" value={card.version} />

      <div className="space-y-1.5">
        <label htmlFor="pub-caption" className="text-xs text-muted-foreground">
          Caption
        </label>
        <Input
          id="pub-caption"
          name="caption"
          defaultValue={card.caption}
          className="h-8 w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="pub-date" className="text-xs text-muted-foreground">
          Date and time
        </label>
        <Input
          id="pub-date"
          name="scheduledAt"
          type="datetime-local"
          defaultValue={toLocalInput(card.scheduledAt)}
          className="h-8 w-56"
        />
      </div>

      {state && !state.ok && <p className="text-xs text-destructive">{state.error}</p>}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" className="h-8" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" type="submit" className="h-8" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
