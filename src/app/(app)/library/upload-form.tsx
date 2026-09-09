"use client";

import { useEffect, useRef, useState } from "react";
import { FileVideo, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { uploadAssetAction } from "@/app/actions/assets";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { PersonaOption } from "@/lib/persona";
import { ALL_PERSONAS } from "@/lib/persona";
import { cn } from "cn";

const RATIOS = ["4:5", "9:16", "1:1"];
const ACCEPTED = ".jpg,.jpeg,.png,.mp4,.mov";

/**
 * Le rating est le choix le plus lourd de conséquences de tout l'écran, et il
 * est **immuable** (9.4). Il mérite donc mieux qu'un menu déroulant: chaque
 * option annonce ce qu'elle autorise, pour que l'opérateur choisisse en
 * connaissance de cause plutôt que de découvrir le blocage au Composer.
 */
const RATINGS = [
  {
    value: "SFW",
    label: "SFW",
    consequence: "Publishable on Instagram. Pushed to R2.",
  },
  {
    value: "SUGGESTIVE",
    label: "Suggestive",
    consequence: "Blocked on Instagram. Stays on the local volume.",
  },
  {
    value: "NSFW",
    label: "NSFW",
    consequence: "Blocked on Instagram. Stays on the local volume.",
  },
] as const;

type QueueItem = {
  file: File;
  previewUrl: string | null;
  status: "queued" | "uploading" | "done" | "failed";
  message?: string;
};

function humanSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadForm({
  personas,
  defaultPersonaId,
  onUploaded,
}: {
  personas: PersonaOption[];
  defaultPersonaId: string;
  onUploaded?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [personaId, setPersonaId] = useState(
    defaultPersonaId === ALL_PERSONAS ? (personas[0]?.id ?? "") : defaultPersonaId,
  );
  const [rating, setRating] = useState<string>("SFW");
  const [ratios, setRatios] = useState<string[]>(["4:5", "9:16"]);
  const [running, setRunning] = useState(false);

  // Les URL d'aperçu sont des ressources: les libérer quand la file change.
  useEffect(() => {
    return () => {
      for (const item of queue) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, [queue]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    setQueue((current) => [
      ...current,
      ...Array.from(files).map((file) => ({
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        status: "queued" as const,
      })),
    ]);
  }

  /**
   * Un envoi par fichier, en série. Grouper les fichiers dans une seule requête
   * ferait dépasser la limite de corps dès deux vidéos, et un échec ferait
   * tomber tout le lot.
   */
  async function submit() {
    if (!personaId || queue.length === 0) return;
    setRunning(true);

    for (const [index, item] of queue.entries()) {
      if (item.status === "done") continue;

      setQueue((current) =>
        current.map((entry, i) => (i === index ? { ...entry, status: "uploading" } : entry)),
      );

      const formData = new FormData();
      formData.set("file", item.file);
      formData.set("personaId", personaId);
      formData.set("rating", rating);
      for (const ratio of ratios) formData.append("ratios", ratio);

      const result = await uploadAssetAction(null, formData);

      setQueue((current) =>
        current.map((entry, i) =>
          i === index
            ? {
                ...entry,
                status: result.ok ? "done" : "failed",
                message: result.ok ? result.message : result.error,
              }
            : entry,
        ),
      );
    }

    setRunning(false);
    onUploaded?.();
  }

  const pending = queue.filter((item) => item.status !== "done").length;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-16 transition-colors",
          dragging ? "border-primary bg-accent" : "border-border hover:bg-accent/40",
        )}
      >
        <Upload className="size-7 text-muted-foreground" />
        <p className="text-base font-medium">
          Drop files here, or click to browse
        </p>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, MP4, MOV — 50 MB per file
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {queue.length > 0 && (
        <ul className="space-y-1.5">
          {queue.map((item, index) => (
            <li
              key={`${item.file.name}-${index}`}
              className="flex items-center gap-3 rounded-md border px-2 py-1.5"
            >
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt=""
                  className="size-10 shrink-0 rounded object-cover"
                />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded bg-muted">
                  <FileVideo className="size-4 text-muted-foreground" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {humanSize(item.file.size)}
                  {item.message && ` — ${item.message}`}
                </p>
              </div>

              {item.status === "uploading" && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
              {item.status !== "uploading" && (
                <Badge
                  variant={
                    item.status === "done"
                      ? "secondary"
                      : item.status === "failed"
                        ? "destructive"
                        : "outline"
                  }
                  className="h-5 shrink-0 px-1.5 text-[10px]"
                >
                  {item.status}
                </Badge>
              )}

              {!running && item.status !== "done" && (
                <button
                  type="button"
                  onClick={() =>
                    setQueue((current) => current.filter((_, i) => i !== index))
                  }
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="personaSelect">Persona</Label>
          <select
            id="personaSelect"
            value={personaId}
            onChange={(event) => setPersonaId(event.target.value)}
            className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
          >
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Ratios to derive</Label>
          <div className="flex h-8 items-center gap-3">
            {RATIOS.map((ratio) => (
              <label key={ratio} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={ratios.includes(ratio)}
                  onChange={(event) =>
                    setRatios((current) =>
                      event.target.checked
                        ? [...current, ratio]
                        : current.filter((r) => r !== ratio),
                    )
                  }
                />
                {ratio}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>Rating</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {RATINGS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRating(option.value)}
                className={cn(
                  "rounded-md border p-2.5 text-left transition-colors",
                  rating === option.value
                    ? "border-primary bg-accent"
                    : "hover:bg-accent/40",
                )}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {option.consequence}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            It drives allowed channels and the push to R2. Changing it later pulls
            the file back out of R2.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={running || pending === 0 || !personaId || ratios.length === 0}
          onClick={submit}
        >
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <ImageIcon className="size-4" />
              Upload {pending > 0 && `(${pending})`}
            </>
          )}
        </Button>
        {queue.some((item) => item.status === "done") && !running && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setQueue((current) => current.filter((i) => i.status !== "done"))}
          >
            Clear completed
          </Button>
        )}
      </div>
    </div>
  );
}
