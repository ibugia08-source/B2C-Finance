"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { B2CSymbol } from "./mascot";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { visibleNavItems, type UserLike } from "./nav-items";

export function Sidebar({ user }: { user: UserLike }) {
  const path = usePathname();
  const visibleItems = visibleNavItems(user);
  return (
    <aside className="hidden md:flex md:w-72 shrink-0 flex-col md:sticky md:top-0 md:h-screen md:self-start border-r bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="px-6 py-5 border-b">
        <div className="flex items-center gap-3">
          <B2CSymbol size={38} />
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-none">
              B2C <span className="text-primary">Finance</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">
              Inteligência financeira
            </p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((it) => {
          const Icon = it.icon;
          const active = path === it.href || path?.startsWith(it.href + "/");
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                active
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-0.5"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  active ? "" : "group-hover:scale-110"
                )}
              />
              {it.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Tema
        </span>
        <ThemeToggle />
      </div>
      {user && <UserMenu user={user} />}
      <div className="px-6 py-3 text-[11px] text-muted-foreground border-t flex items-center justify-between">
        <span>v1.0 · Rebrand</span>
        <span className="text-gold">★ premium</span>
      </div>
    </aside>
  );
}
