import { ComposerPanel } from "./composer-panel";

/**
 * `/composer` chargé directement — rafraîchissement, lien partagé, retour
 * d'historique. Rend le modal, pas une page: le composeur n'a pas de forme
 * « plein écran ».
 */
export default async function ComposerPage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string; asset?: string; album?: string; ratio?: string }>;
}) {
  const { at, asset, album, ratio } = await searchParams;
  return <ComposerPanel at={at} assetId={asset} albumId={album} ratio={ratio} />;
}
