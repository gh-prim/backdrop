import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export type Usage = {
  publicationId: string;
  name: string;
  kind: string;
  status: string;
  platform: string;
  ratio: string;
  position: number;
  scheduledAt: string;
  publishedAt: string | null;
  remoteId: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline",
  SCHEDULED: "secondary",
  PUBLISHING: "default",
  PUBLISHED: "default",
  FAILED: "destructive",
  MISSED: "destructive",
};

/**
 * Où ce média est déjà parti.
 *
 * C'est l'information qui manque le plus quand on gère plusieurs personas:
 * republier deux fois le même visuel sur le même compte se voit, et se voit mal.
 */
export function UsageList({ usages }: { usages: Usage[] }) {
  if (usages.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Jamais utilisé. Aucune publication ne référence ce média.
      </p>
    );
  }

  return (
    <ul className="divide-y text-sm">
      {usages.map((usage) => (
        <li
          key={`${usage.publicationId}-${usage.position}`}
          className="flex flex-wrap items-center gap-2 py-2"
        >
          <Badge
            variant={STATUS_VARIANT[usage.status] ?? "outline"}
            className="h-5 px-1.5 text-[10px]"
          >
            {usage.status}
          </Badge>
          <Link href="/publications" className="font-medium hover:underline">
            {usage.name || "(sans nom)"}
          </Link>
          <span className="text-xs text-muted-foreground">
            {usage.platform} · {usage.kind} · {usage.ratio}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {new Date(usage.publishedAt ?? usage.scheduledAt).toLocaleString("fr-FR", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}
