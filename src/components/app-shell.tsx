"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarWithToggle } from "./sidebar-with-toggle";
import { MobileHeader } from "./mobile-header";
import { MobileNav } from "./mobile-nav";
import { UndoToastHost } from "./undo-toast";
import type { UserLike } from "./nav-items";

// /f = formulário público de contratos (sem sidebar/menus, como o login).
const NO_SHELL = ["/login", "/f"];

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: UserLike;
}) {
  const path = usePathname() ?? "";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const bare = NO_SHELL.some((p) => path === p || path.startsWith(p + "/"));

  if (bare) return <>{children}</>;

  return (
    <>
      {/* Mobile Header (only visible on mobile) */}
      <MobileHeader
        title="B2C Finance"
        onMenuClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        user={user}
        showTheme={true}
        showUser={true}
      />

      <div className="flex min-h-screen app-shell">
        <SidebarWithToggle
          user={user}
          defaultExpanded={true}
          responsive={true}
          mobileVariant="drawer"
          mobileOpen={mobileMenuOpen}
          onMobileOpenChange={setMobileMenuOpen}
        />
        <main
          key={path}
          // Conteúdo contido (max-w) e centralizado: em monitores largos a
          // linha de leitura não estica de ponta a ponta — tabelas continuam
          // com todo o espaço útil de que precisam.
          // pb-24 no mobile abre espaço para a tab bar inferior.
          className="page-enter flex-1 p-3 sm:p-4 md:p-5 lg:p-6 pb-24 md:pb-6 w-full min-w-0"
        >
          <div className="mx-auto w-full max-w-[1560px]">{children}</div>
        </main>
      </div>
      <MobileNav user={user} />
      <UndoToastHost />
    </>
  );
}
