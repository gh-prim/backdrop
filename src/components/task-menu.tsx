"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Clock, Loader2, ListChecks } from "lucide-react";
import { readActiveTasksAction, type ActiveTask } from "@/app/actions/tasks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";

const POLL_MS = 4000;
const RUNNING = new Set(["PUBLISHING"]);
const TERMINAL = new Set(["PUBLISHED", "FAILED", "MISSED"]);

/**
 * Tâches en cours, dans la barre du haut.
 *
 * Une publication programmée part souvent pendant que l'opérateur fait autre
 * chose: sans ce menu, il ne l'apprend qu'en rouvrant l'écran des
 * publications. Le passage en état terminal déclenche donc une notification,
 * quel que soit l'écran affiché.
 */
export function TaskMenu() {
  const router = useRouter();
  const [tasks, setTasks] = useState<ActiveTask[]>([]);
  /** Dernier état connu, pour ne notifier que les transitions. */
  const seen = useRef(new Map<string, string>());
  const primed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const next = await readActiveTasksAction();
        if (cancelled) return;

        for (const task of next) {
          const previous = seen.current.get(task.publicationId);
          seen.current.set(task.publicationId, task.status);

          // Le premier passage ne notifie rien: on découvre l'existant, on ne
          // rejoue pas l'historique des dernières minutes.
          if (!primed.current || previous === task.status) continue;
          if (!TERMINAL.has(task.status)) continue;

          notify(task);
          router.refresh();
        }
        primed.current = true;
        setTasks(next);
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    }

    timer = setTimeout(tick, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  const running = tasks.filter((task) => RUNNING.has(task.status));
  const scheduled = tasks.filter((task) => task.status === "SCHEDULED");
  const settled = tasks.filter((task) => TERMINAL.has(task.status));
  const pending = running.length + scheduled.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-8 gap-2 px-2" />}
      >
        {running.length > 0 ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ListChecks className="size-3.5" />
        )}
        <span className="text-xs">{pending}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="border-b px-3 py-2 text-xs font-medium">
          {pending === 0 ? "Nothing in flight" : `${pending} in flight`}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {running.map((task) => (
            <TaskRow key={task.publicationId} task={task} />
          ))}
          {scheduled.map((task) => (
            <TaskRow key={task.publicationId} task={task} />
          ))}
          {settled.length > 0 && (
            <div className="border-t px-3 py-1.5 text-[10px] uppercase text-muted-foreground">
              Just finished
            </div>
          )}
          {settled.map((task) => (
            <TaskRow key={task.publicationId} task={task} />
          ))}
          {tasks.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No publication scheduled or running.
            </p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskRow({ task }: { task: ActiveTask }) {
  const running = RUNNING.has(task.status);
  const failed = task.status === "FAILED" || task.status === "MISSED";
  const published = task.status === "PUBLISHED";

  return (
    <div className="space-y-1 border-b px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2 text-sm">
        {running && <Loader2 className="size-3 shrink-0 animate-spin" />}
        {published && <Check className="size-3 shrink-0" />}
        {failed && <AlertTriangle className="size-3 shrink-0 text-destructive" />}
        {task.status === "SCHEDULED" && (
          <Clock className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{task.name || "(untitled)"}</span>
        <Badge variant="outline" className="ml-auto h-4 shrink-0 px-1 text-[9px]">
          {task.platform}
        </Badge>
      </div>

      {/* Barre indéterminée: le workflow attend Instagram, dont on ne sait pas
          combien de temps il prendra. Une barre chiffrée mentirait. */}
      {running && (
        <div className="h-0.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] bg-primary" />
        </div>
      )}

      <p
        className={cn(
          "truncate text-[11px]",
          failed ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {running && (task.step ?? "Sending…")}
        {task.status === "SCHEDULED" &&
          new Date(task.scheduledAt).toLocaleString("en-GB", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        {published && `Published · ${task.remoteId}`}
        {failed && (task.failureReason ?? task.status)}
      </p>
    </div>
  );
}

function notify(task: ActiveTask) {
  const title =
    task.status === "PUBLISHED"
      ? `Published on ${task.platform}`
      : task.status === "MISSED"
        ? `Missed on ${task.platform}`
        : `Failed on ${task.platform}`;
  const body = task.name || task.failureReason || "";

  if (task.status === "PUBLISHED") toast.success(title, { description: body });
  else toast.error(title, { description: body });

  // Notification système quand l'onglet n'est pas au premier plan: une
  // publication qui part à 22 h mérite mieux qu'un toast que personne ne voit.
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted" && document.hidden) {
    new Notification(title, { body });
  } else if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}
