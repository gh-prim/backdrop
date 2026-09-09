"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Check, Hash, HelpCircle, X } from "lucide-react";
import {
  checkHashtagsAction,
  readHashtagsAction,
  type HashtagResult,
} from "@/app/actions/hashtags";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

const MAX_PER_POST = 30;

/**
 * Panneau des hashtags d'une légende.
 *
 * Deux plafonds sont affichés parce qu'ils sont indépendants et qu'on les
 * confond: le nombre de hashtags **dans la publication** (30, imposé par
 * Instagram), et le nombre de hashtags **interrogeables par semaine** (30
 * aussi, mais côté API). Le second se consomme à la vérification, jamais à la
 * frappe — d'où le bouton explicite.
 */
export function HashtagPanel({
  channelAccountId,
  caption,
}: {
  channelAccountId: string;
  caption: string;
}) {
  const [report, setReport] = useState<HashtagResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Lecture du cache à chaque changement de légende: aucun appel à Instagram.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      readHashtagsAction(channelAccountId, caption).then((next) => {
        if (!cancelled) setReport(next);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [channelAccountId, caption]);

  if (!report?.ok) {
    return report && !report.ok ? (
      <p className="text-xs text-destructive">{report.error}</p>
    ) : null;
  }

  const { hashtags, budgetUsed, budgetTotal, skipped } = report;
  const unchecked = hashtags.filter((tag) => !tag.known).length;
  const invalid = hashtags.filter((tag) => tag.known && !tag.valid);
  const overLimit = hashtags.length > MAX_PER_POST;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Hash className="size-3.5" />
          Hashtags
        </span>
        <span
          className={cn(
            "text-xs",
            overLimit ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {hashtags.length} / {MAX_PER_POST}
        </span>

        {unchecked > 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="ml-auto h-7 px-2 text-xs"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setReport(await checkHashtagsAction(channelAccountId, caption));
              })
            }
          >
            {pending ? "Checking…" : `Check ${unchecked} new`}
          </Button>
        )}
      </div>

      {hashtags.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {hashtags.map((tag) => (
            <li
              key={tag.name}
              title={
                !tag.known
                  ? "Not checked yet"
                  : !tag.valid
                    ? "Instagram does not return this hashtag: it does not exist, or it is restricted"
                    : tag.competition
                      ? `Top posts median: ${tag.competition.toLocaleString("en-GB")} likes`
                      : "Valid"
              }
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                !tag.known && "bg-muted text-muted-foreground",
                tag.known && tag.valid && "bg-accent text-foreground",
                tag.known && !tag.valid && "bg-destructive/15 text-destructive",
              )}
            >
              {!tag.known && <HelpCircle className="size-2.5" />}
              {tag.known && tag.valid && <Check className="size-2.5" />}
              {tag.known && !tag.valid && <X className="size-2.5" />}
              #{tag.name}
              {tag.competition !== null && (
                <span className="text-muted-foreground">
                  {tag.competition >= 1000
                    ? `${Math.round(tag.competition / 1000)}k`
                    : tag.competition}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {overLimit && (
        <p className="flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          Instagram accepts {MAX_PER_POST} hashtags per post. Remove{" "}
          {hashtags.length - MAX_PER_POST}.
        </p>
      )}

      {invalid.length > 0 && (
        <p className="text-[11px] text-destructive">
          {invalid.map((tag) => `#${tag.name}`).join(", ")}: not returned by Instagram —
          either non-existent or restricted. They will publish, but reach nothing.
        </p>
      )}

      {skipped.length > 0 && (
        <p className="text-[11px] text-destructive">
          Weekly lookup budget exhausted, left unchecked:{" "}
          {skipped.map((name) => `#${name}`).join(", ")}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Lookup budget: {budgetUsed} / {budgetTotal} unique hashtags over 7 days. A known
        hashtag is never queried again — the number below counts checks, not posts.
      </p>
    </div>
  );
}
