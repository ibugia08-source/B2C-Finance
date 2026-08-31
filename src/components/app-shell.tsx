"use client";
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { MobileHeader } from "./mobile-header";
import { MobileMenu } from "./mobile-menu";
import { MobileNav } from "./mobile-nav";
import { SiteHeader } from "./site-header";
import { CommandPalette } from "./command-palette";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { GlobalShortcuts } from "./global-shortcuts";
import { UndoToastHost } from "./undo-toast";
import type { UserLike } from "./nav-items";
import type { ScopeOptions } from "@/lib/services/org-scope";

// /f = formulário público de contratos (sem casca, como o login).
const NO_SHELL = ["/login", "/f"];

/**
 * CASCA DO B2C FINANCE: barra global (SiteHeader) + conteúdo + navegação
 * mobile. No mobile: linha de título com hambúrguer (gaveta) + a mesma
 * subnav + barra inferior de espaços.
 *
 * A casca também hospeda os três serviços globais do F1.14 — paleta de
 * comandos, mapa de atalhos e escutador de teclado. Eles ficam aqui, e
 * não em cada página, porque precisam de UMA instância válida em toda
 * tela: montá-los por página faria dois escutadores brigarem pela mesma
 * tecla durante a transição de rota.
 */
export function AppShell({
  children,
  user,
  scopeOptions,
}: {
  children: React.ReactNode;
  user: UserLike;
  scopeOptions: ScopeOptions;
}) {
  const path = usePathname() ?? "";
  const bare = NO_SHELL.some((p) => path === p || path.startsWith(p + "/"));
  if (bare) return <>{children}</>;

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-surface">
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
          <SiteHeader user={user} scopeOptions={scopeOptions} />
        </Suspense>
      </header>

      <main
        key={path}
        // pb-24 no mobile abre espaço para a tab bar inferior.
        className="page-enter w-full min-w-0 flex-1 p-3 pb-24 sm:p-4 md:p-5 md:pb-6 lg:p-6"
      >
        <div className="mx-auto w-full max-w-content">{children}</div>
      </main>

      <MobileNav user={user} />
      <UndoToastHost />

      {/* Busca, paleta e atalhos: uma instância só, válida em toda tela. */}
      <CommandPalette user={user} />
      <ShortcutsDialog user={user} />
      <GlobalShortcuts user={user} />
    </div>
  );
}
