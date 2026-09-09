"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Préférence d'affichage persistée localement, par opérateur.
 *
 * `useSyncExternalStore` plutôt qu'un effet: la valeur vit dans localStorage,
 * qui est une source externe. Bénéfice concret, la préférence est partagée
 * entre tous les composants qui la lisent, sans état remonté ni rechargement.
 */
const listeners = new Map<string, Set<() => void>>();

function subscribers(key: string) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  return listeners.get(key) as Set<() => void>;
}

export function useLocalPreference<T extends string | number>(
  key: string,
  fallback: T,
  parse: (raw: string) => T,
): [T, (value: T) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = subscribers(key);
      set.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        set.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  }, [key, fallback, parse]);

  // Côté serveur, la valeur par défaut: le rendu initial doit être stable.
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: T) => {
      localStorage.setItem(key, String(next));
      for (const listener of subscribers(key)) listener();
    },
    [key],
  );

  return [value, set];
}
