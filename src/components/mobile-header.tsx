"use client";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import type { UserLike } from "./nav-items";

interface MobileHeaderProps {
  title?: string;
  subtitle?: string;
  onMenuClick?: () => void;
  user?: UserLike;
  sticky?: boolean;
  showTheme?: boolean;
  showUser?: boolean;
}

export function MobileHeader({
  title,
  subtitle,
  onMenuClick,
  user,
  sticky = true,
  showTheme = true,
  showUser = true,
}: MobileHeaderProps) {
  return (
    <header
      className={cn(
        "md:hidden bg-background/95 backdrop-blur border-b supports-[backdrop-filter]:bg-background/80",
        sticky && "sticky top-0 z-30",
        "flex items-center h-14 px-3 gap-2"
      )}
      style={{ paddingTop: `max(0.75rem, env(safe-area-inset-top, 0.75rem))` }}
    >
      {/* Hamburger Button */}
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className={cn(
            "flex items-center justify-center rounded-lg transition-colors",
            "h-10 w-10 min-h-touch",
            "hover:bg-accent hover:text-accent-foreground",
            "active:scale-95"
          )}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* Title & Subtitle */}
      {title && (
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold truncate text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* Actions: Theme + User Menu */}
      <div className="flex items-center gap-1">
        {showTheme && <ThemeToggle className="scale-75 origin-right" />}
        {showUser && user && <UserMenu user={user} />}
      </div>
    </header>
  );
}
