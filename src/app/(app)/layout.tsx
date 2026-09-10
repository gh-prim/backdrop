import Link from "next/link";
import { requireOrgContext } from "@/lib/session";
import { getSelectedPersonaId, listPersonas } from "@/lib/persona-scope";
import { PersonaSwitcher } from "@/components/persona-switcher";
import { UserMenu } from "@/components/user-menu";
import { TaskMenu } from "@/components/task-menu";

/**
 * Le composeur n'y figure pas: c'est une action, pas une destination. On
 * l'ouvre depuis là où l'on compose — un créneau du calendrier, le dashboard,
 * la liste des publications.
 */
const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/library", label: "Library" },
  { href: "/publications", label: "Publications" },
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
                className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <TaskMenu />
            <UserMenu name={ctx.userName} email={ctx.userEmail} role={ctx.role} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>

      {/* Le composeur s'ouvre ici, par-dessus la page courante. Vide partout
          ailleurs (voir @modal/default.tsx). */}
      {modal}
    </div>
  );
}
