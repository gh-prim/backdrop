import { ComposerPanel } from "../../composer/composer-panel";

/**
 * Composeur ouvert par-dessus la page courante.
 *
 * Route interceptée: `/composer` reste une URL partageable, et un
 * rafraîchissement rend le même modal plutôt que de perdre la composition.
 */
export default async function ComposerModalPage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string }>;
}) {
  const { at } = await searchParams;
  return <ComposerPanel at={at} />;
}
