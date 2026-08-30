"use client";
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { MobileHeader } from "./mobile-header";
import { MobileMenu } from "./mobile-menu";
import { MobileNav } from "./mobile-nav";
import { SiteHeader } from "./site-header";
import { UndoToastHost } from "./undo-toast";
import type { UserLike } from "./nav-items";

// /f = formulário público de contratos (sem casca, como o login).
const NO_SHELL = ["/login", "/f"];

/**
 * CASCA DO B2C FINANCE 2 (30/08): barra superior + subnav do espaço ativo
 * (SiteHeader) — a sidebar deixou de existir. No mobile: linha de título
 * com hambúrguer (gaveta) + a mesma subnav + barra inferior de espaços.
 */
export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: UserLike;
}) {
  const path = usePathname() ?? "";
  const bare = NO_SHELL.some((p) => path === p || path.startsWith(p + "/"));
  if (bare) return <>{children}</>;

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <MobileHeader
          title="B2C Finance"
          user={user}
          menuSlot={
            <MobileMenu
              user={user}
              trigger={
                <button
                  type="button"
                  aria-label="Abrir menu"
                  className="flex h-10 w-10 min-h-touch items-center justify-center rounded-lg transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Menu className="h-5 w-5" />
                </button>
              }
            />
          }
        />
        {/* useSearchParams (preserva ?mes=) exige Suspense em prerender. */}
        <Suspense fallback={null}>
          <SiteHeader user={user} />
        </Suspense>
      </header>

      <main
        key={path}
        // pb-24 no mobile abre espaço para a tab bar inferior.
        className="page-enter w-full min-w-0 flex-1 p-3 pb-24 sm:p-4 md:p-5 md:pb-6 lg:p-6"
      >
        <div className="mx-auto w-full max-w-[1560px]">{children}</div>
      </main>

      <MobileNav user={user} />
      <UndoToastHost />
    </div>
  );
}
