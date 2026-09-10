"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import {
  exportConfigAction,
  importConfigAction,
  type ImportResult,
} from "@/app/actions/config-backup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportPlan } from "@/lib/config-backup";

/**
 * Sauvegarde et restauration de la **configuration**.
 *
 * Les médias n'y sont pas: ils pèsent des gigaoctets et vivent sur un volume.
 * Ce fichier sert à remonter une instance — personas, canaux, hashtags déjà
 * résolus, albums — pas à déménager la bibliothèque.
 */
export function BackupPanel({ isOwner }: { isOwner: boolean }) {
  if (!isOwner) {
    return (
      <p className="text-xs text-muted-foreground">
        Only an owner can export or import the configuration.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ExportSide />
      <ImportSide />
    </div>
  );
}

function ExportSide() {
  const [withSecrets, setWithSecrets] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await exportConfigAction(withSecrets ? passphrase : null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // Le fichier est fabriqué ici: il ne transite par aucun disque serveur,
      // et rien n'en reste après le téléchargement.
      const url = URL.createObjectURL(
        new Blob([result.json], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);

      toast.success(
        result.withSecrets
          ? "Configuration exported, credentials sealed."
          : "Configuration exported, without credentials.",
      );
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Export</h3>
        <p className="text-xs text-muted-foreground">
          Personas, channels, Instagram hashtags already resolved, and albums.
          Media and publications stay here.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={withSecrets}
          onChange={(event) => setWithSecrets(event.target.checked)}
        />
        <span>
          Include credentials
          <span className="block text-xs text-muted-foreground">
            {/* Le compromis est dit là où il se prend: sans identifiants, le
                fichier décrit l'installation mais ne la rebranche pas. */}
            Sealed with the passphrase below — the browser only ever sees the
            sealed block. Without them, an import recreates everything except the
            channels, which you reconnect by hand.
          </span>
        </span>
      </label>

      {withSecrets && (
        <div className="space-y-1.5">
          <Label htmlFor="export-passphrase">Passphrase</Label>
          <Input
            id="export-passphrase"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="12 characters minimum"
            className="h-8"
          />
          <p className="text-xs text-muted-foreground">
            It is not stored anywhere. Lose it and the file is unusable.
          </p>
        </div>
      )}

      <Button type="button" size="sm" disabled={pending} onClick={run}>
        <Download className="size-3.5" />
        {pending ? "Preparing…" : "Export configuration"}
      </Button>

      <p className="text-xs text-muted-foreground">
        Telegram sessions are not in this file: they live in an encrypted TDLib
        directory on the worker. A restored instance keeps the api_id/api_hash
        and asks for a fresh login code.
      </p>
    </section>
  );
}

function ImportSide() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [pending, startTransition] = useTransition();

  function handle(result: ImportResult, applied: boolean) {
    if (!result.ok) {
      toast.error(result.error);
      setPlan(null);
      return;
    }
    setPlan(result.plan);
    if (applied) {
      toast.success("Configuration imported.");
      setFileText(null);
      setFilename("");
      setPassphrase("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function run(dryRun: boolean) {
    if (!fileText) return;
    startTransition(async () => {
      handle(
        await importConfigAction(fileText, passphrase || null, dryRun),
        !dryRun,
      );
    });
  }

  return (
    <section className="space-y-3 lg:border-l lg:pl-6">
      <div>
        <h3 className="text-sm font-medium">Import</h3>
        <p className="text-xs text-muted-foreground">
          {/* La propriété qui rassure avant de cliquer: rien ne disparaît. */}
          Never destructive: what already exists is updated, what is missing is
          created, nothing is deleted.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="block w-full text-xs file:mr-3 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-xs"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          setPlan(null);
          if (!file) {
            setFileText(null);
            setFilename("");
            return;
          }
          setFileText(await file.text());
          setFilename(file.name);
        }}
      />

      <div className="space-y-1.5">
        <Label htmlFor="import-passphrase">Passphrase</Label>
        <Input
          id="import-passphrase"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="Only if the file carries credentials"
          className="h-8"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!fileText || pending}
          onClick={() => run(true)}
        >
          Preview
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!fileText || pending || plan === null}
          onClick={() => run(false)}
        >
          <Upload className="size-3.5" />
          Apply
        </Button>
        {filename && (
          <span className="self-center text-xs text-muted-foreground">{filename}</span>
        )}
      </div>

      {plan && <PlanSummary plan={plan} />}
    </section>
  );
}

function PlanSummary({ plan }: { plan: ImportPlan }) {
  const lines: [string, string][] = [
    ["Personas", `${plan.personasCreated.length} created · ${plan.personasUpdated.length} updated`],
    ["Channels", `${plan.channelsCreated.length} created · ${plan.channelsUpdated.length} updated`],
    ["Telegram apps", `${plan.telegramAppsCreated.length}`],
    ["Hashtags", `${plan.hashtags}`],
    ["Albums", `${plan.albumsCreated.length} created`],
  ];

  return (
    <div className="space-y-2 rounded-md border p-3">
      <dl className="space-y-1 text-xs">
        {lines.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {plan.channelsSkipped.length > 0 && (
        <div className="text-xs text-destructive">
          <p className="font-medium">{plan.channelsSkipped.length} left out:</p>
          <ul className="mt-0.5 space-y-0.5">
            {plan.channelsSkipped.map((skipped) => (
              <li key={skipped.key}>
                {skipped.key} — {skipped.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.missingMedia > 0 && (
        <p className="text-xs text-muted-foreground">
          {plan.missingMedia} album entries have no matching media here: those
          albums arrive incomplete until the files are uploaded.
        </p>
      )}
    </div>
  );
}
