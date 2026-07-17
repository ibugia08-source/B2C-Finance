"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, type UserLike } from "./nav-items";
import { MobileMenu } from "./mobile-menu";

const primary = NAV_ITEMS.filter((it) => it.primary);

export function MobileNav({ user }: { user: UserLike }) {
  const path = usePathname();

  const itemClasses = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-md text-[10px] font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active ? "text-primary" : "text-muted-foreground hover:text-foreground"
    );

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch justify-around border-t bg-background/95 px-1 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      {primary.map((it) => {
        const Icon = it.icon;
        const active = path === it.href || path?.startsWith(it.href + "/");
        return (
          <Link key={it.href} href={it.href} className={itemClasses(active)}>
            <Icon className="h-5 w-5" />
            {it.short ?? it.label}
          </Link>
        );
      })}
      <MobileMenu
        user={user}
        trigger={
          <button type="button" aria-label="Mais opções" className={itemClasses(false)}>
            <Menu className="h-5 w-5" />
            Mais
          </button>
        }
      />
    </nav>
  );
}
