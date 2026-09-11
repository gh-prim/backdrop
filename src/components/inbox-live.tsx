"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff } from "lucide-react";
import { cn } from "cn";

const PING_PREFERENCE_KEY = "backdrop.inbox.ping";

/**
 * La préférence de son, lue dans `localStorage`.
 *
 * `useSyncExternalStore` plutôt qu'un effet: la valeur vit hors de React, ce
 * qui est exactement le cas pour lequel ce hook existe — et c'est déjà le
 * motif retenu pour le flou des vignettes. Elle est propre à l'opérateur et à
 * son poste: personne ne doit imposer un son à son collègue.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function pingEnabled(): boolean {
  return localStorage.getItem(PING_PREFERENCE_KEY) === "on";
}

/** Côté serveur, silencieux: le défaut discret est le bon défaut. */
function serverSnapshot(): boolean {
  return false;
}

function setPingEnabled(value: boolean) {
  localStorage.setItem(PING_PREFERENCE_KEY, value ? "on" : "off");
  for (const listener of listeners) listener();
}

/**
 * L'écoute du flux d'événements, montée une fois pour toute l'application.
 *
 * Elle vit dans la barre plutôt que dans l'écran d'inbox: un message qui
 * arrive pendant qu'on prépare une publication doit faire apparaître la
 * pastille rouge tout de suite, pas à la prochaine visite de l'inbox.
 *
 * Le flux ne porte pas le message, seulement le fait qu'un fil a bougé: on
 * redemande alors la page, ce qui met à jour la pastille, la liste et le fil
 * ouvert d'un seul geste et sans dupliquer la logique d'affichage.
 */
export function InboxLive() {
  const router = useRouter();
  const ping = useSyncExternalStore(subscribe, pingEnabled, serverSnapshot);
  const audio = useRef<(() => void) | null>(null);

  useEffect(() => {
    audio.current = makeChime();
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/inbox/stream");

    source.onmessage = () => {
      router.refresh();
      if (pingEnabled()) audio.current?.();
    };

    // `EventSource` se reconnecte seul après une coupure: on ne ferme donc
    // pas sur erreur, au risque d'éteindre l'écoute pour de bon.
    return () => source.close();
  }, [router]);

  return (
    <button
      type="button"
      onClick={() => {
        const next = !ping;
        setPingEnabled(next);
        // Un aperçu au moment où on l'active: sinon on ne découvre le son
        // qu'au premier message, c'est-à-dire par surprise.
        if (next) audio.current?.();
      }}
      className={cn(
        "rounded-md p-1.5 transition-colors hover:bg-accent",
        ping ? "text-foreground" : "text-muted-foreground",
      )}
      title={ping ? "Sound on for new messages" : "Sound off for new messages"}
      aria-label={ping ? "Disable the new message sound" : "Enable the new message sound"}
    >
      {ping ? <Bell className="size-4" /> : <BellOff className="size-4" />}
    </button>
  );
}

/**
 * Un son court, synthétisé plutôt que chargé.
 *
 * Embarquer un fichier audio pour deux dixièmes de seconde de sinusoïde
 * pèserait plus que le code qui la produit, et il faudrait le servir. Le
 * contexte n'est créé qu'au premier usage: les navigateurs refusent de
 * l'ouvrir avant une interaction, et le faire au chargement ne donnerait
 * qu'un avertissement dans la console.
 */
function makeChime(): () => void {
  let context: AudioContext | null = null;

  return () => {
    try {
      context ??= new AudioContext();
      void context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      // Une décroissance nette: un son qui traîne devient pénible au
      // vingtième message de la journée.
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
    } catch {
      // Pas de son disponible: ce n'est pas une raison d'interrompre quoi que
      // ce soit. La pastille rouge reste la vraie notification.
    }
  };
}
