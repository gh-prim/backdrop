import Link from "next/link";
import { requireOrgContext } from "@/lib/session";
import { getSelectedPersonaId, listPersonas } from "@/lib/persona-scope";
import { ALL_PERSONAS } from "@/lib/persona";
import { countUnread } from "@/lib/inbox";
import { unreadLabel } from "@/lib/unread-shared";
import { PersonaSwitcher } from "@/components/persona-switcher";
import { UserMenu } from "@/components/user-menu";
import { TaskMenu } from "@/components/task-menu";
import { InboxLive } from "@/components/inbox-live";
import { APP_VERSION } from "@/lib/version";
import { AppMain } from "@/components/app-main";

/**
 * Le composeur n'y figure pas: c'est une action, pas une destination. On
 * l'ouvre depuis là où l'on compose — un créneau du calendrier, le dashboard,
 * la liste des publications.
 */
const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/library", label: "Library" },
  { href: "/publications", label: "Publications" },
  { href: "/inbox", label: "Inbox" },
  { href: "/calendar", label: "Calendar" },
  { href: "/settings", label: "Settings" },
];


export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  /** Slot parallèle du composeur, ouvert par-dessus la page courante. */
  modal: React.ReactNode;
}) {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);
  // Compté au rendu de la barre: le badge suit donc la navigation. Le tenir à
  // jour sans recharger viendra avec le flux d'événements.
  const unread = await countUnread(
    ctx,
    selectedId === ALL_PERSONAS ? undefined : selectedId,
  );

  return (
    <div className="flex min-h-svh flex-col">
      {/* Sélecteur de persona persistant, visible sur tous les écrans (6.1). */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        {/* Même gouttière que le contenu: l'alignement du header sur la page
            est ce qui fait la différence entre « appli » et « page web ». */}
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-5 px-6">
          <Link
            href="/"
            className="text-sm font-black tracking-tight transition-opacity hover:opacity-70"
          >
            Backdrop
          </Link>

          <PersonaSwitcher personas={personas} selectedId={selectedId} />

          <nav className="hidden items-center gap-0.5 text-sm md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="relative rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {item.label}
                {item.href === "/inbox" && unread > 0 && (
                  // Rouge, et seulement ici: c'est la seule information de
                  // l'application qui demande une réponse de quelqu'un.
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unreadLabel(unread)}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {/* Monté dans la barre, donc sur tous les écrans: un message reçu
                pendant qu'on prépare une publication doit faire apparaître la
                pastille tout de suite, pas à la prochaine visite de l'inbox. */}
            <InboxLive />
            <TaskMenu />
            <UserMenu name={ctx.userName} email={ctx.userEmail} role={ctx.role} />
          </div>
        </div>
      </header>

      <AppMain>{children}</AppMain>

      {/* La version, en bas à gauche et discrète. Elle ne sert qu'à une chose:
          distinguer « déployé » de « supposé déployé », sans ouvrir un
          terminal. Fixe plutôt que flottante — une pastille qui suit le
          défilement encombrerait tous les écrans pour une information qu'on
          consulte une fois par déploiement. */}
      <footer className="mx-auto w-full max-w-7xl px-6 pb-4">
        <span className="text-[10px] text-muted-foreground/60">v{APP_VERSION}</span>
      </footer>

      {/* Le composeur s'ouvre ici, par-dessus la page courante. Vide partout
          ailleurs (voir @modal/default.tsx). */}
      {modal}
    </div>
  );
}
