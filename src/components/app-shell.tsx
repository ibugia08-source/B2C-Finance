"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarWithToggle } from "./sidebar-with-toggle";
import { MobileHeader } from "./mobile-header";
import { MobileNav } from "./mobile-nav";
import type { UserLike } from "./nav-items";

const NO_SHELL = ["/login"];

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
          defaultExpanded={false}
          responsive={true}
          mobileVariant="drawer"
          mobileOpen={mobileMenuOpen}
          onMobileOpenChange={setMobileMenuOpen}
        />
        <main
          key={path}
          // Respiro progressivo: 16 → 24 → 32 → 40px (sem salto brusco 16→40).
          // pb-24 no mobile abre espaço para a tab bar inferior.
          className="page-enter flex-1 p-4 sm:p-6 md:p-8 lg:p-10 pb-24 md:pb-10 max-w-7xl mx-auto w-full"
        >
          {children}
        </main>
      </div>
      <MobileNav user={user} />
    </>
  );
}
