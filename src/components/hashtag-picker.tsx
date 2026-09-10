"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Hash, Loader2, Plus, X } from "lucide-react";
import {
  addHashtagAction,
  listKnownHashtagsAction,
  type KnownHashtag,
} from "@/app/actions/hashtags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

import { MAX_HASHTAGS_PER_POST, extractHashtags } from "@/lib/hashtags-shared";

/**
 * Choix des hashtags Instagram.
 *
 * Ils ne se tapent plus dans la légende: celle-ci est commune à tout l'envoi,
 * et Telegram n'a rien à faire d'une traîne de croisillons. Ils sont choisis
 * ici et concaténés à la légende **de la seule publication Instagram** — l'API
 * n'ayant pas de champ dédié, ils doivent bien s'y retrouver (4.1.11).
 *
 * Deux plafonds distincts, souvent confondus:
 *
 *  * **30 par publication**, imposé par Instagram sur la légende;
 *  * **30 interrogations uniques par 7 jours** via l'API, qui n'a rien à voir.
 *
 * Le second ne se consomme qu'à la **découverte** d'un hashtag. Reprendre un
 * hashtag déjà connu est gratuit, et c'est ce qui rend la limite vivable: on
 * la paie une fois, jamais deux.
 */
export function HashtagPicker({
  channelAccountId,
  caption,
  selected,
  onChange,
}: {
  channelAccountId: string;
  /** Légende commune: ce qu'on y a tapé compte dans le même plafond. */
  caption: string;
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  const [known, setKnown] = useState<KnownHashtag[] | null>(null);
  const [budget, setBudget] = useState({ used: 0, total: 30 });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void listKnownHashtagsAction(channelAccountId).then((result) => {
      if (!alive) return;
      setKnown(result.hashtags);
      setBudget({ used: result.budgetUsed, total: result.budgetTotal });
    });
    return () => {
      alive = false;
    };
  }, [channelAccountId]);

  // Ce qui est tapé dans la légende compte dans le même plafond: l'ignorer
  // laisserait passer un dépassement qu'Instagram refuse à l'envoi.
  const inCaption = useMemo(() => extractHashtags(caption), [caption]);
  const total = useMemo(
    () => new Set([...inCaption, ...selected]).size,
    [inCaption, selected],
  );
  const full = total >= MAX_HASHTAGS_PER_POST;

  // Les retenus d'abord: à trente hashtags, retrouver ce qu'on a coché dans une
  // liste triée par concurrence devient un travail.
  const ordered = useMemo(() => {
    if (!known) return [];
    const picked = new Set(selected);
    return [...known].sort((a, b) => {
      const byPicked = Number(picked.has(b.name)) - Number(picked.has(a.name));
      return byPicked !== 0 ? byPicked : 0;
    });
  }, [known, selected]);

  function toggle(name: string) {
    if (selected.includes(name)) onChange(selected.filter((x) => x !== name));
    else if (!full) onChange([...selected, name]);
  }

  function add() {
    const raw = draft.trim();
    if (!raw) return;
    setError(null);

    startTransition(async () => {
      const result = await addHashtagAction(channelAccountId, raw);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDraft("");
      setBudget((current) => ({ ...current, used: result.budgetUsed }));
      setKnown((current) => {
        const rest = (current ?? []).filter((h) => h.name !== result.hashtag.name);
        return [result.hashtag, ...rest];
      });
      if (!selected.includes(result.hashtag.name) && !full) {
        onChange([...selected, result.hashtag.name]);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="flex items-center gap-1.5 text-sm font-medium">
          <Hash className="size-3.5" />
          Hashtags
        </h4>
        <span className={cn("text-xs", full ? "text-destructive" : "text-muted-foreground")}>
          {total} / {MAX_HASHTAGS_PER_POST} on this post
          {inCaption.length > 0 && ` · ${inCaption.length} typed in the caption`}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {budget.used} / {budget.total} lookups used this week
        </span>
      </div>

      {known === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Reading saved hashtags…
        </p>
      ) : (
        <>
          {ordered.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None saved yet. The first one you add costs a lookup; every reuse
              afterwards is free.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ordered.map((hashtag) => {
                const picked = selected.includes(hashtag.name);
                return (
                  <button
                    key={hashtag.name}
                    type="button"
                    disabled={!picked && full}
                    onClick={() => toggle(hashtag.name)}
                    title={
                      hashtag.competition === null
                        ? undefined
                        : `${hashtag.competition} median likes on top posts`
                    }
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                      picked
                        ? "border-primary bg-primary/15 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                      !picked && full && "cursor-not-allowed opacity-40",
                    )}
                  >
                    #{hashtag.name}
                    {picked && <X className="size-3" />}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // Sans ça, Entrée soumettrait le formulaire du composeur.
                  event.preventDefault();
                  add();
                }
              }}
              placeholder="add a hashtag…"
              className="h-8 w-48"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={pending || draft.trim().length === 0}
              onClick={add}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Plus />}
              Add
            </Button>
            <span className="text-xs text-muted-foreground">
              A new hashtag costs one lookup. Reusing a saved one costs nothing.
            </span>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {selected.length > 0 && (
            <p className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
              Appended to the Instagram caption only:{" "}
              <span className="text-foreground">
                {selected.map((name) => `#${name}`).join(" ")}
              </span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
