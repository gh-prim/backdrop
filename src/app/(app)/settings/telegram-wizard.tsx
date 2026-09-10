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
import { WizardSteps } from "@/components/wizard-steps";
import type { TelegramLoginState } from "@/temporal/config";
import type { PersonaOption } from "@/lib/persona";

const STEPS = ["Persona", "API keys", "Phone", "Code"] as const;

/**
 * Connexion d'un compte Telegram, en session utilisateur (4.2.1).
 *
 * Le parcours suit ce que MTProto impose et rien d'autre: Telegram envoie un
 * code, l'opérateur le saisit, et un client doit rester connecté entre les
 * deux. Ce wizard ne fait que suivre l'état d'un workflow qui, lui, détient ce
 * client. Ni le code ni le mot de passe ne sont conservés ici.
 */
export function TelegramWizard({
  personas,
  configuredPersonaIds,
  initialPersonaId,
  onDone,
}: {
  personas: PersonaOption[];
  configuredPersonaIds: string[];
  /**
   * Persona à reconnecter. Une session TDLib est un répertoire lié à la
   * machine: une instance restaurée ailleurs a le compte en base mais plus de
   * session, et c'est ce parcours-là qui la refait.
   */
  initialPersonaId?: string;
  onDone: () => void;
}) {
  const [personaId, setPersonaId] = useState(
    initialPersonaId ?? personas[0]?.id ?? "",
  );
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const [step, setStep] = useState(0);

  const hasKeys = configuredPersonaIds.includes(personaId) || savedKeys.includes(personaId);

  if (personas.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Create a persona first: a Telegram account is always attached to one.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <WizardSteps
        steps={STEPS}
        current={step}
        maxReached={step}
        onJump={step < 3 ? (index) => setStep(Math.min(index, step)) : undefined}
      />

      {step === 0 && (
        <PersonaStep
          personas={personas}
          personaId={personaId}
          hasKeys={hasKeys}
          onChange={setPersonaId}
          onNext={() => setStep(hasKeys ? 2 : 1)}
        />
      )}

      {step === 1 && (
        <ApiKeysStep
          personaId={personaId}
          onSaved={() => {
            setSavedKeys((ids) => [...ids, personaId]);
            setStep(2);
          }}
        />
      )}

      {step >= 2 && (
        <LoginStep
          key={personaId}
          personaId={personaId}
          onAwaitingCode={() => setStep(3)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function PersonaStep({
  personas,
  personaId,
  hasKeys,
  onChange,
  onNext,
}: {
  personas: PersonaOption[];
  personaId: string;
  hasKeys: boolean;
  onChange: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="tg-persona">Which persona is this account for?</Label>
        <select
          id="tg-persona"
          value={personaId}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
        >
          {personas.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {persona.name} · @{persona.handle}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        {hasKeys
          ? "This persona already has its API keys. You can go straight to the phone number."
          : "Each persona carries its own api_id and its own session."}
      </p>

      <div className="flex justify-end">
        <Button type="button" size="sm" className="h-8" onClick={onNext}>
          {hasKeys ? "Continue" : "Next"}
        </Button>
      </div>
    </div>
  );
}

function ApiKeysStep({
  personaId,
  onSaved,
}: {
  personaId: string;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveTelegramAppAction,
    null,
  );
  // Contrôlés: une action qui échoue reconstruit le formulaire, et des champs
  // non contrôlés perdraient la saisie. Retaper un api_hash de 32 caractères
  // parce que le serveur a échoué est une punition injustifiée.
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");

  useEffect(() => {
    if (state?.ok) onSaved();
    // Le déclencheur est le résultat de l'action, pas l'identité du callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="personaId" value={personaId} />

      <div className="space-y-1.5">
        <Label htmlFor="apiId">api_id</Label>
        <Input
          id="apiId"
          name="apiId"
          value={apiId}
          onChange={(event) => setApiId(event.target.value)}
          required
          inputMode="numeric"
          className="h-8 w-40"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="apiHash">api_hash</Label>
        <Input
          id="apiHash"
          name="apiHash"
          type="password"
          value={apiHash}
          onChange={(event) => setApiHash(event.target.value)}
          required
          autoComplete="off"
          className="h-8 w-full"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Sign in to my.telegram.org <em>as this persona</em>, then API development tools. One
        api_id flagged for automation would otherwise take down every persona sharing it.
      </p>

      {state?.ok === false && <p className="text-xs text-destructive">{state.error}</p>}

      <div className="flex justify-end">
        <Button type="submit" size="sm" className="h-8" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}

function LoginStep({
  personaId,
  onAwaitingCode,
  onDone,
}: {
  personaId: string;
  onAwaitingCode: () => void;
  onDone: () => void;
}) {
  const [started, startAction, starting] = useActionState<LoginStarted | null, FormData>(
    startTelegramLoginAction,
    null,
  );
  const [status, setStatus] = useState<TelegramLoginState | null>(null);
  // Même raison qu'à l'étape précédente: un échec ne doit pas effacer le
  // numéro. Un champ vidé fait recliquer sur « Send code » et déclenche la
  // validation native du navigateur, qui masque la vraie erreur.
  const [phone, setPhone] = useState("");
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

  useEffect(() => {
    if (phase === "awaiting_code" || phase === "awaiting_password") onAwaitingCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "connected" && status?.account) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Connected as{" "}
          <span className="font-medium">
            {status.account.username
              ? `@${status.account.username}`
              : status.account.telegramUserId}
          </span>
          .
        </p>
        <p className="text-xs text-muted-foreground">
          The session is encrypted at rest and lives only in the Telegram worker.
        </p>
        <div className="flex justify-end">
          <Button type="button" size="sm" className="h-8" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (loginId && phase !== "failed" && phase !== "idle") {
    return (
      <SecretStep
        loginId={loginId}
        phase={phase}
        detail={status?.detail ?? null}
      />
    );
  }

  return (
    <form action={startAction} className="space-y-3">
      <input type="hidden" name="personaId" value={personaId} />

      <div className="space-y-1.5">
        <Label htmlFor="tg-phone">Phone number</Label>
        <Input
          id="tg-phone"
          name="phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
          placeholder="+33612345678"
          className="h-8 w-52"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Telegram sends the code inside the app, not by SMS. This session is what will publish, so
        connect the persona&apos;s own account.
      </p>

      {started?.ok === false && <p className="text-xs text-destructive">{started.error}</p>}
      {status?.state === "failed" && status.detail && (
        <p className="text-xs text-destructive">{status.detail}</p>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="sm" className="h-8" disabled={starting}>
          {starting ? "Sending…" : "Send code"}
        </Button>
      </div>
    </form>
  );
}

function SecretStep({
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

  if (phase === "starting") {
    return <p className="py-4 text-sm text-muted-foreground">Asking Telegram for a code…</p>;
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="loginId" value={loginId} />

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

      <p className="text-xs text-muted-foreground">
        {awaitingPassword
          ? "This account has two-step verification. The password goes straight to Telegram and is never stored."
          : "Telegram sent it inside the app, not by SMS. It expires after a few minutes."}
      </p>

      {detail && <p className="text-xs text-destructive">{detail}</p>}
      {state?.ok === false && <p className="text-xs text-destructive">{state.error}</p>}

      <div className="flex justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => void cancelTelegramLoginAction(loginId)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-8" disabled={pending}>
          {pending ? "Checking…" : awaitingPassword ? "Unlock" : "Confirm"}
        </Button>
      </div>
    </form>
  );
}
