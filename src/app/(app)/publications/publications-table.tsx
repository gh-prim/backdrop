"use client";

import { Fragment, useState, useTransition } from "react";
import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cancelPublicationAction,
  publishMissedNowAction,
  reschedulePublicationAction,
  type ActionResult,
} from "@/app/actions/publications";

export type PublicationRow = {
  id: string;
  kind: string;
  status: string;
  caption: string;
  scheduledAt: string;
  publishedAt: string | null;
  remoteId: string | null;
  failureReason: string | null;
  version: number;
  author: string;
  platform: string;
  persona: string;
  itemCount: number;
  rating: string;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline",
  SCHEDULED: "secondary",
  PUBLISHING: "default",
  PUBLISHED: "default",
  FAILED: "destructive",
  MISSED: "destructive",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PublicationsTable({ rows }: { rows: PublicationRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>État</TableHead>
          <TableHead>Persona</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Programmée</TableHead>
          <TableHead>Légende</TableHead>
          <TableHead>Auteur</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <Fragment key={row.id}>
            <TableRow>
              <TableCell>
                <Badge
                  variant={STATUS_VARIANT[row.status] ?? "outline"}
                  className="h-5 px-1.5 text-[10px]"
                >
                  {row.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">
                {row.persona}
                <span className="ml-1 text-xs text-muted-foreground">{row.platform}</span>
              </TableCell>
              <TableCell className="text-xs">
                {row.kind}
                {row.itemCount > 1 && ` · ${row.itemCount}`}
                <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px]">
                  {row.rating}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {formatDate(row.scheduledAt)}
              </TableCell>
              <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                {row.caption || "—"}
              </TableCell>
              {/* Attribution: toute publication affiche son auteur (7.4). */}
              <TableCell className="text-xs">{row.author}</TableCell>
              <TableCell className="text-right">
                <RowActions row={row} editing={editing} setEditing={setEditing} />
              </TableCell>
            </TableRow>

            {row.failureReason && (
              <TableRow>
                <TableCell colSpan={7} className="pt-0 text-xs text-destructive">
                  {row.failureReason}
                </TableCell>
              </TableRow>
            )}

            {row.status === "MISSED" && (
              <TableRow>
                <TableCell colSpan={7} className="pt-0 text-xs text-muted-foreground">
                  Échéance dépassée au-delà de la tolérance: rien n&apos;a été publié, la
                  décision vous revient.
                </TableCell>
              </TableRow>
            )}

            {editing === row.id && (
              <TableRow>
                <TableCell colSpan={7}>
                  <RescheduleForm row={row} onDone={() => setEditing(null)} />
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function RowActions({
  row,
  editing,
  setEditing,
}: {
  row: PublicationRow;
  editing: string | null;
  setEditing: (id: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex justify-end gap-1">
      {row.status === "SCHEDULED" && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing(editing === row.id ? null : row.id)}
          >
            Modifier
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={() => startTransition(() => void cancelPublicationAction(row.id))}
          >
            Annuler
          </Button>
        </>
      )}
      {row.status === "MISSED" && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={pending}
          onClick={() => startTransition(() => void publishMissedNowAction(row.id))}
        >
          Publier maintenant
        </Button>
      )}
      {row.remoteId && (
        <span className="self-center text-[10px] text-muted-foreground">
          {row.remoteId}
        </span>
      )}
    </div>
  );
}

function RescheduleForm({
  row,
  onDone,
}: {
  row: PublicationRow;
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
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="publicationId" value={row.id} />
      {/* Verrou optimiste: la version lue à l'affichage est renvoyée telle
          quelle. Si quelqu'un est passé entre-temps, l'écriture est rejetée. */}
      <input type="hidden" name="expectedVersion" value={row.version} />

      <Input
        name="caption"
        defaultValue={row.caption}
        className="h-8 w-96"
        placeholder="Légende"
      />
      <Input
        name="scheduledAt"
        type="datetime-local"
        defaultValue={toLocalInput(row.scheduledAt)}
        className="h-8 w-52"
      />
      <Button size="sm" type="submit" disabled={pending}>
        Enregistrer
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={onDone}>
        Fermer
      </Button>
      {state && !state.ok && (
        <p className="w-full text-xs text-destructive">{state.error}</p>
      )}
    </form>
  );
}
