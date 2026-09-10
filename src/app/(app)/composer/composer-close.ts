"use client";

import { createContext, useContext } from "react";

/**
 * Fermeture du composeur, fournie par ce qui l'héberge.
 *
 * En modal, l'envoi doit refermer la fenêtre; en page pleine, il doit
 * naviguer. Le formulaire ne peut pas deviner lequel des deux — et pousser
 * vers `/publications` depuis un modal ouvert **par-dessus** cette même page
 * ne referme rien: l'URL ne change pas, la route interceptée reste montée, et
 * l'opérateur reste devant un formulaire qui a pourtant fini son travail.
 */
export const ComposerCloseContext = createContext<(() => void) | null>(null);

export function useComposerClose(): (() => void) | null {
  return useContext(ComposerCloseContext);
}
