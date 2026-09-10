"use client";

import { cn } from "cn";

/**
 * Fil d'étapes d'un wizard de modal.
 *
 * Même grammaire que les onglets d'une page de détail et que le composer (6.1):
 * pleine largeur, soulignés, jamais des cases. La différence tient à ce qu'une
 * étape non atteinte reste inaccessible — un wizard de connexion se parcourt
 * dans l'ordre, chaque étape dépendant du résultat de la précédente.
 */
export function WizardSteps({
  steps,
  current,
  maxReached,
  onJump,
}: {
  steps: readonly string[];
  current: number;
  maxReached: number;
  onJump?: (index: number) => void;
}) {
  return (
    <ol className="-mx-4 flex items-stretch border-b text-xs">
      {steps.map((label, index) => {
        const isCurrent = index === current;
        const reachable = index <= maxReached && onJump !== undefined;
        return (
          <li key={label} className="flex-1">
            <button
              type="button"
              disabled={!reachable || isCurrent}
              onClick={() => onJump?.(index)}
              className={cn(
                "relative flex w-full items-center justify-center px-2 py-2 transition-colors",
                isCurrent ? "font-medium text-foreground" : "text-muted-foreground",
                reachable && !isCurrent && "hover:text-foreground",
                !reachable && !isCurrent && "cursor-default opacity-40",
                isCurrent &&
                  "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground",
              )}
            >
              {label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
