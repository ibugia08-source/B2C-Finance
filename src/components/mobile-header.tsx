"use client";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import type { UserLike } from "./nav-items";

interface MobileHeaderProps {
  title?: string;
  subtitle?: string;
  /** Gatilho do menu (ex.: MobileMenu com botão hambúrguer). */
  menuSlot?: React.ReactNode;
  user?: UserLike;
  showTheme?: boolean;
  showUser?: boolean;
}

/**
 * Linha 1 do cabeçalho no mobile/tablet (< lg). Fundo, borda e sticky são
 * responsabilidade do <header> wrapper no AppShell — aqui só o conteúdo.
 */
export function MobileHeader({
  title,
  subtitle,
  menuSlot,
  user,
  showTheme = true,
  showUser = true,
}: MobileHeaderProps) {
  return (
    <div
      className={cn("lg:hidden flex items-center h-14 px-3 gap-2")}
      style={{ paddingTop: `max(0.5rem, env(safe-area-inset-top, 0.5rem))` }}
    >
      {menuSlot}
      {title && (
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-sm font-semibold truncate text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
      )}
      <div className="flex items-center gap-1">
        {showTheme && <ThemeToggle className="scale-75 origin-right" />}
        {showUser && user && <UserMenu user={user} compact />}
      </div>
    </div>
  );
}
