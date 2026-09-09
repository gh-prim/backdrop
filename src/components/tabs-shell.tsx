"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "cn";

export type ShellTab = {
  value: string;
  label: string;
  content: React.ReactNode;
  /** Un panneau qui gère lui-même sa hauteur, comme un aperçu plein cadre. */
  fill?: boolean;
};

/**
 * Coquille d'une page de détail (spec 6.1).
 *
 * Applique la règle en un seul endroit: hauteur contrainte, onglets pleine
 * largeur soulignés, sidebar droite persistante, et défilement confiné aux
 * panneaux. Les pages qui l'utilisent n'ont plus à s'en préoccuper — et ne
 * peuvent plus l'oublier.
 */
export function TabsShell({
  tabs,
  sidebar,
  defaultValue,
}: {
  tabs: ShellTab[];
  sidebar?: React.ReactNode;
  defaultValue?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 gap-5",
        sidebar && "md:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]",
      )}
    >
      <Tabs
        defaultValue={defaultValue ?? tabs[0]?.value}
        className="flex min-h-0 flex-col gap-3"
      >
        <TabsList variant="line" className="w-full border-b">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent
            key={tab.value}
            value={tab.value}
            className={cn("min-h-0", tab.fill ? "overflow-hidden" : "overflow-y-auto pr-1")}
          >
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>

      {sidebar && (
        <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">{sidebar}</aside>
      )}
    </div>
  );
}

/** Conteneur de page à hauteur contrainte: la page ne défile jamais. */
export function FixedHeightPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100svh-7.5rem)] flex-col gap-4 overflow-hidden">
      {children}
    </div>
  );
}
