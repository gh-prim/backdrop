"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock, ExternalLink, Loader2, X } from "lucide-react";
import {
  readProgressAction,
  type PublicationProgress,
} from "@/app/actions/progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";

const TERMINAL = new Set(["PUBLISHED", "FAILED", "MISSED"]);

/**
 * Suivi d'envoi.
 *
 * Les étapes affichées viennent du workflow lui-même, par requête Temporal:
 * il n'y a pas d'animation qui simule un avancement. Quand la barre s'arrête
 * à 70 % sur « Waiting for Instagram to process the media », c'est qu'Instagram
 * est réellement en train d'encoder.
 */
export function PublishProgressDialog({
  publicationIds,
  onClose,
}: {
  publicationIds: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PublicationProgress[] | null>(null);

  useEffect(() => {
    if (publicationIds.length === 0) return;
    let cancelled = false;

    async function tick() {
      const next = await readProgressAction(publicationIds);
      if (cancelled) return;
      setRows(next);

      // On cesse d'interroger dès que tout est joué: une publication
      // programmée pour dans six heures n'a rien à raconter entre-temps.
      const settled = next.every(
        (row) => TERMINAL.has(row.status) || row.progress?.state === "waiting",
      );
      if (!settled) timer = setTimeout(tick, 1200);
    }

    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [publicationIds]);

  const allSettled =
    rows !== null && rows.every((row) => TERMINAL.has(row.status));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          router.refresh();
          onClose();
        }
      }}
    >
      <DialogContent className="w-[92vw] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {rows === null
              ? "Sending…"
              : allSettled
                ? "Done"
                : `Sending ${rows.length} publication${rows.length > 1 ? "s" : ""}`}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          {rows === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Reading the workflow…
            </p>
          ) : (
            rows.map((row) => <ProgressRow key={row.publicationId} row={row} />)
          )}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant={allSettled ? "default" : "ghost"}
            onClick={() => {
              router.refresh();
              onClose();
            }}
          >
            {allSettled ? "Close" : "Close and keep sending"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProgressRow({ row }: { row: PublicationProgress }) {
  const progress = row.progress;
  const failed = row.status === "FAILED" || progress?.state === "failed";
  const missed = row.status === "MISSED" || progress?.state === "missed";
  const published = row.status === "PUBLISHED";
  const waiting = progress?.state === "waiting";

  const percent = published ? 100 : (progress?.percent ?? 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{row.platform}</span>
        <span className="truncate text-muted-foreground">{row.name}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs">
          {published && <Check className="size-3.5" />}
          {failed && <AlertTriangle className="size-3.5 text-destructive" />}
          {missed && <Clock className="size-3.5 text-destructive" />}
          {!published && !failed && !missed && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          )}
          {percent}%
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full transition-[width] duration-500",
            failed || missed ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      </div>

      {/* Journal réel: une ligne par étape franchie par le workflow. */}
      <ul className="space-y-0.5 font-mono text-[11px]">
        {(progress?.steps ?? []).map((step, index) => (
          <li
            key={`${step.label}-${index}`}
            className={cn(
              "flex items-center gap-1.5",
              step.status === "done" && "text-muted-foreground",
              step.status === "active" && "text-foreground",
              step.status === "failed" && "text-destructive",
            )}
          >
            {step.status === "done" && <Check className="size-2.5 shrink-0" />}
            {step.status === "active" && (
              <Loader2 className="size-2.5 shrink-0 animate-spin" />
            )}
            {step.status === "failed" && <X className="size-2.5 shrink-0" />}
            {step.label}
          </li>
        ))}
        {progress === null && !TERMINAL.has(row.status) && (
          <li className="text-muted-foreground">Waiting for the worker to pick it up…</li>
        )}
      </ul>

      {waiting && !published && (
        <p className="text-[11px] text-muted-foreground">
          Scheduled: this window can be closed, the workflow keeps waiting on its own.
        </p>
      )}

      {row.failureReason && (
        <p className="text-[11px] text-destructive">{row.failureReason}</p>
      )}

      {published && row.remoteId && (
        <a
          href={`https://www.instagram.com/p/${row.remoteId}/`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-3" />
          media {row.remoteId}
        </a>
      )}
    </div>
  );
}
