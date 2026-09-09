import Link from "next/link";
import { requireOrgContext } from "@/lib/session";
import { getSelectedPersonaId, listPersonas } from "@/lib/persona-scope";
import { PersonaSwitcher } from "@/components/persona-switcher";
import { UserMenu } from "@/components/user-menu";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/library", label: "Library" },
  { href: "/calendrier", label: "Calendrier" },
  { href: "/reglages", label: "Réglages" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireOrgContext();
  const personas = await listPersonas(ctx);
  const selectedId = await getSelectedPersonaId(personas);

  return (
    <div className="flex min-h-svh flex-col">
      {/* Sélecteur de persona persistant, visible sur tous les écrans (6.1). */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-12 items-center gap-4 px-4">
          <Link href="/" className="text-sm font-black tracking-tight">
            Backdrop
          </Link>

          <PersonaSwitcher personas={personas} selectedId={selectedId} />

          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto">
            <UserMenu name={ctx.userName} email={ctx.userEmail} role={ctx.role} />
          </div>
        </div>
      </header>

      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
