"use client";

import { useRouter } from "next/navigation";
import { ComposerCloseContext } from "@/app/(app)/composer/composer-close";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Enveloppe du composeur.
 *
 * Le composeur est **toujours** un modal: composer est une action, jamais une
 * destination. La route interceptée l'ouvre par-dessus la page courante, et
 * `/composer` chargé directement rend ce même modal — pas une page.
 *
 * Fermer revient en arrière, ce qui ramène exactement là d'où l'on vient — un
 * créneau du calendrier, le dashboard, la bibliothèque. Sur une arrivée
 * directe il n'y a rien derrière soi: on part alors vers les publications,
 * plutôt que de sortir de l'application.
 */
export function ComposerModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  function close() {
    if (window.history.length > 1) router.back();
    else router.replace("/publications");
  }

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && close()}>
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

        {/* Le formulaire referme lui-même la fenêtre quand l'envoi est
            accepté: lui seul sait quand son travail est fini. */}
        <ComposerCloseContext.Provider value={close}>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </ComposerCloseContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
