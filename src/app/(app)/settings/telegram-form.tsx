"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  cancelTelegramLoginAction,
  readTelegramLoginStateAction,
  saveTelegramAppAction,
  startTelegramLoginAction,
  submitTelegramCodeAction,
  submitTelegramPasswordAction,
  type ActionResult,
  type LoginStarted,
} from "@/app/actions/telegram";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { TelegramLoginState } from "@/temporal/config";
import type { PersonaOption } from "@/lib/persona";

/**
 * Connexion Telegram, en session utilisateur (4.2.1).
 *
 * Le login se fait en plusieurs temps parce que MTProto l'impose: Telegram
 * envoie un code, l'opérateur le saisit, et un client doit rester connecté
 * entre les deux. Cet écran ne fait que suivre l'état d'un workflow qui, lui,
 * détient ce client.
 *
 * Ni le code ni le mot de passe ne sont conservés ici: ils partent au workflow
 * et le champ est vidé.
 */
export function TelegramForm({
  personas,
  configured,
}: {
  personas: PersonaOption[];
  configured: boolean;
}) {
  return (
    <div className="space-y-5">
      <TelegramAppForm configured={configured} />
      {configured && personas.length > 0 && <TelegramLogin personas={personas} />}
    </div>
  );
}

function TelegramAppForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveTelegramAppAction,
    null,
  );
  const [open, setOpen] = useState(!configured);

  if (configured && !open) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">Telegram application</span>
        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
          api_id saved
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7"
          onClick={() => setOpen(true)}
        >
          Replace
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="apiId">api_id</Label>
          <Input id="apiId" name="apiId" required inputMode="numeric" className="h-8 w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apiHash">api_hash</Label>
          <Input
            id="apiHash"
            name="apiHash"
            type="password"
            required
            autoComplete="off"
            className="h-8 w-80"
          />
        </div>
        <Button type="submit" size="sm" className="h-8" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {configured && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        One api_id and api_hash for the whole application, from my.telegram.org under API
        development tools. They are encrypted at rest and never shown again, not even to an
        owner.
      </p>

      {state?.ok === false && <p className="text-xs text-destructive">{state.error}</p>}
      {state?.ok === true && (
        <p className="text-xs text-muted-foreground">Saved. You can now connect a persona.</p>
      )}
    </form>
  );
}

function TelegramLogin({ personas }: { personas: PersonaOption[] }) {
  const [started, startAction, starting] = useActionState<LoginStarted | null, FormData>(
    startTelegramLoginAction,
    null,
  );
  const [status, setStatus] = useState<TelegramLoginState | null>(null);
  const loginId = started?.ok ? started.loginId : null;

  // Le workflow est la source de vérité: l'écran ne devine rien, il demande.
  useEffect(() => {
    if (!loginId) return;
    let alive = true;

    const tick = async () => {
      const next = await readTelegramLoginStateAction(loginId).catch(() => null);
      if (alive && next) setStatus(next);
    };

    void tick();
    const timer = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [loginId]);

  const phase = status?.state ?? (loginId ? "starting" : "idle");

  if (phase === "connected" && status?.account) {
    return (
      <div className="space-y-2 rounded-md border p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">Connected</span>
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {status.account.username ? `@${status.account.username}` : status.account.telegramUserId}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          The session is encrypted at rest and lives only in the Telegram worker. Reconnecting
          the same account replaces it.
        </p>
      </div>
    );
  }

  if (loginId && (phase === "awaiting_code" || phase === "awaiting_password" || phase === "starting")) {
    return (
      <CodeStep
        loginId={loginId}
        phase={phase}
        detail={status?.detail ?? null}
      />
    );
  }

  return (
    <form action={startAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="tg-persona">Persona</Label>
          <select
            id="tg-persona"
            name="personaId"
            className="h-8 rounded-md border bg-transparent px-2 text-sm"
          >
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tg-phone">Phone number</Label>
          <Input
            id="tg-phone"
            name="phone"
            required
            placeholder="+33612345678"
            className="h-8 w-52"
          />
        </div>
        <Button type="submit" size="sm" className="h-8" disabled={starting}>
          {starting ? "Sending…" : "Send code"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Telegram sends the code to that account, inside the app. Connect the persona&apos;s
        account, not your own: this session is what will publish.
      </p>

      {started?.ok === false && <p className="text-xs text-destructive">{started.error}</p>}
      {(phase === "failed" || status?.state === "failed") && status?.detail && (
        <p className="text-xs text-destructive">{status.detail}</p>
      )}
    </form>
  );
}

function CodeStep({
  loginId,
  phase,
  detail,
}: {
  loginId: string;
  phase: string;
  detail: string | null;
}) {
  const awaitingPassword = phase === "awaiting_password";
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    awaitingPassword ? submitTelegramPasswordAction : submitTelegramCodeAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Le secret ne reste pas dans le champ une fois parti au workflow.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="loginId" value={loginId} />

      {phase === "starting" ? (
        <p className="text-sm text-muted-foreground">Asking Telegram for a code…</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="tg-secret">
              {awaitingPassword ? "Two-step verification password" : "Code from Telegram"}
            </Label>
            <Input
              id="tg-secret"
              name={awaitingPassword ? "password" : "code"}
              type={awaitingPassword ? "password" : "text"}
              autoComplete="off"
              autoFocus
              inputMode={awaitingPassword ? undefined : "numeric"}
              className="h-8 w-44"
            />
          </div>
          <Button type="submit" size="sm" className="h-8" disabled={pending}>
            {pending ? "Checking…" : awaitingPassword ? "Unlock" : "Confirm"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => void cancelTelegramLoginAction(loginId)}
          >
            Cancel
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {awaitingPassword
          ? "This account has two-step verification. The password goes straight to Telegram and is never stored."
          : "Telegram sent it inside the app, not by SMS. It expires after a few minutes."}
      </p>

      {detail && <p className="text-xs text-destructive">{detail}</p>}
      {state?.ok === false && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
