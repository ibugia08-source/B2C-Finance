"use client";
import { usePathname } from "next/navigation";
import { SidebarWithToggle } from "./sidebar-with-toggle";
import { MobileNav } from "./mobile-nav";

const NO_SHELL = ["/login"];

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { name: string; email: string; role: "ADMIN" | "USER" } | null;
}) {
  const path = usePathname() ?? "";
  const bare = NO_SHELL.some((p) => path === p || path.startsWith(p + "/"));

  if (bare) return <>{children}</>;

  return (
    <>
      <div className="flex min-h-screen app-shell">
        <SidebarWithToggle
          user={user}
          defaultExpanded={false}
          responsive={true}
          mobileVariant="drawer"
        />
        <main
          key={path}
          className="page-enter flex-1 p-3 sm:p-4 md:p-10 pb-24 md:pb-10 max-w-7xl mx-auto w-full"
        >
          {children}
        </main>
      </div>
      <MobileNav user={user} />
    </>
  );
}
