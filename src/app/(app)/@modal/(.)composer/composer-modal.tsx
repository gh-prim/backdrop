"use client";

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Enveloppe du composeur en modal.
 *
 * Fermer revient en arrière plutôt que de naviguer vers une page: c'est ce qui
 * ramène exactement là d'où l'on vient — un créneau du calendrier, le
 * dashboard, la bibliothèque.
 */
export function ComposerModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && router.back()}>
      <DialogContent
        // Hauteur libre, plafonnée. Forcer une hauteur pleine donnait un cadre
        // de 800 pixels presque vide sur les premières étapes, qui ne portent
        // qu'un champ: le modal grandit avec le contenu et s'arrête net avant
        // de déborder de l'écran.
        //
        // `sm:max-w-none` et non `max-w-none`: la classe de base du composant
        // porte `sm:max-w-sm`, et une variante de media query l'emporte sur une
        // classe nue quel que soit l'ordre d'écriture.
        className="flex max-h-[86svh] w-[min(94vw,60rem)] max-w-none flex-col gap-4 overflow-hidden sm:max-w-none"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>New publication</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
