"use client";

import { useTransition } from "react";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { selectPersona } from "@/app/actions/persona";
import { ALL_PERSONAS, type PersonaOption } from "@/lib/persona";

export function PersonaSwitcher({
  personas,
  selectedId,
}: {
  personas: PersonaOption[];
  selectedId: string;
}) {
  const [pending, startTransition] = useTransition();
  const selected = personas.find((p) => p.id === selectedId);

  function choose(id: string) {
    startTransition(() => {
      void selectPersona(id);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-w-52 justify-between gap-2 px-2 font-normal"
          />
        }
      >
        <span className="flex items-center gap-2 truncate">
          {selected ? (
            <>
              <span className="truncate font-medium">{selected.name}</span>
              <span className="truncate text-muted-foreground">@{selected.handle}</span>
            </>
          ) : (
            <>
              <Users className="size-3.5 text-muted-foreground" />
              <span>Toutes les personas</span>
            </>
          )}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Persona active
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => choose(ALL_PERSONAS)} className="gap-2">
            <Users className="size-3.5" />
            <span className="flex-1">Toutes les personas</span>
            {selectedId === ALL_PERSONAS && <Check className="size-3.5" />}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        {personas.length > 0 && <DropdownMenuSeparator />}

        {personas.map((persona) => (
          <DropdownMenuItem
            key={persona.id}
            onClick={() => choose(persona.id)}
            className="gap-2"
          >
            <span className="flex-1 truncate">
              {persona.name}
              <span className="ml-1.5 text-muted-foreground">@{persona.handle}</span>
            </span>
            {selectedId === persona.id && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
