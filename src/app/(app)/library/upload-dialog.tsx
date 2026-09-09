"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PersonaOption } from "@/lib/persona";
import { UploadForm } from "./upload-form";

/**
 * L'upload vit dans une modale, pas en permanence sur la page.
 *
 * Une zone de dépôt affichée en continu prend la moitié de l'écran pour un
 * geste occasionnel, et repousse la bibliothèque — qui est ce qu'on vient
 * réellement consulter — sous la ligne de flottaison.
 */
export function UploadDialog({
  personas,
  defaultPersonaId,
}: {
  personas: PersonaOption[];
  defaultPersonaId: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // À la fermeture, recharger: les Assets ajoutés doivent apparaître
        // dans la grille sans que l'opérateur ait à recharger lui-même.
        if (!next) router.refresh();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Upload className="size-4" />
        Uploader
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Uploader des médias</DialogTitle>
          <DialogDescription>
            Le rating choisi ici est définitif: il commande les canaux autorisés et
            le passage par R2.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <UploadForm
            personas={personas}
            defaultPersonaId={defaultPersonaId}
            onUploaded={() => router.refresh()}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
