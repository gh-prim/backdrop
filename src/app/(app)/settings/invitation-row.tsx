"use client";

import { useState, useTransition } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cancelInvitationAction } from "@/app/actions/members";
import type { PendingInvitation } from "@/lib/invitations";

export function InvitationRow({
  invitation,
}: {
  invitation: Omit<PendingInvitation, "expiresAt"> & { expiresAt: Date | string };
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const link =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/invitation/${invitation.id}`;

  return (
    <li className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
      <span className="truncate">{invitation.email}</span>
      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] uppercase">
        {invitation.role}
      </Badge>
      {invitation.expired && (
        <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
          expired
        </Badge>
      )}

      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={pending}
          onClick={() => startTransition(() => void cancelInvitationAction(invitation.id))}
        >
          <X className="size-3" />
        </Button>
      </div>
    </li>
  );
}
