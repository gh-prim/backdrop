"use client";

import { usePathname } from "next/navigation";
import { cn } from "cn";

/**
 * La gouttière de contenu, sauf là où elle gêne.
 *
 * Les écrans de l'outil sont des pages: une largeur maximale les garde
 * lisibles. L'inbox n'en est pas une — c'est un plan de travail à deux
 * colonnes, et lui imposer la même gouttière laisserait deux bandes vides sur
 * un écran large pendant que le fil, lui, serait à l'étroit.
 */
const FULL_WIDTH = ["/inbox"];

export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const full = FULL_WIDTH.some((prefix) => pathname.startsWith(prefix));

  return (
    <main
      className={cn(
        "mx-auto w-full flex-1",
        full ? "px-4 py-4" : "max-w-7xl px-6 py-8",
      )}
    >
      {children}
    </main>
  );
}
