"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { B2CLogo } from "./mascot";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { visibleNavItems, type UserLike } from "./nav-items";

interface SidebarWithToggleProps {
  user: UserLike;
  defaultExpanded?: boolean;
  responsive?: boolean;
  mobileVariant?: "drawer" | "bottom-sheet";
  onStateChange?: (expanded: boolean) => void;
}

const STORAGE_KEY = "b2c:sidebar:state";

export function SidebarWithToggle({
  user,
  defaultExpanded = false,
  responsive = true,
  mobileVariant = "drawer",
  onStateChange,
}: SidebarWithToggleProps) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isClient, setIsClient] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hydrate from localStorage
  useEffect(() => {
    setIsClient(true);
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const expandedFromStorage = stored === "true";
      setExpanded(expandedFromStorage);
    } else {
      setExpanded(defaultExpanded);
    }
  }, [defaultExpanded]);

  // Persist to localStorage
  useEffect(() => {
    if (isClient) {
      localStorage.setItem(STORAGE_KEY, expanded.toString());
      onStateChange?.(expanded);
    }
  }, [expanded, isClient, onStateChange]);

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const toggleMobileOpen = () => {
    setMobileOpen(!mobileOpen);
  };

  const closeMobileMenu = () => {
    setMobileOpen(false);
  };

  const visibleItems = visibleNavItems(user);

  if (!isClient) return null;

  // Desktop Sidebar (≥ lg: always visible)
  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:flex-col lg:border-r lg:bg-card/60 lg:backdrop-blur lg:supports-[backdrop-filter]:bg-card/60 sidebar-collapse",
          expanded ? "lg:w-72" : "lg:w-20"
        )}
      >
        {/* Header with Logo & Toggle */}
        <div className="border-b px-4 py-4 lg:px-6 lg:py-5">
          <div className="flex items-center justify-between gap-2">
            {expanded && (
              <div className="flex items-end gap-2 flex-1">
                <B2CLogo height={30} />
                <div className="pb-0.5">
                  <h1 className="text-lg font-semibold tracking-tight leading-none text-foreground">
                    Finance
                  </h1>
                </div>
              </div>
            )}
            {!expanded && (
              <div className="mx-auto">
                <B2CLogo height={24} />
              </div>
            )}
            <button
              onClick={toggleExpand}
              className="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            >
              {expanded ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
          {expanded && (
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1.5">
              Gestão financeira
            </p>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {visibleItems.map((it, i) => {
            const Icon = it.icon;
            const active = pathname === it.href || pathname?.startsWith(it.href + "/");
            const newSection = it.section && it.section !== visibleItems[i - 1]?.section;

            return (
              <div key={it.href}>
                {newSection && expanded && (
                  <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                    {it.section}
                  </p>
                )}
                <Link
                  href={it.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                    "min-h-touch justify-center lg:justify-start",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-0.5"
                  )}
                  title={!expanded ? it.label : undefined}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5 flex-shrink-0 transition-transform duration-200",
                      active ? "" : "group-hover:scale-110"
                    )}
                  />
                  {expanded && <span className="flex-1">{it.label}</span>}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Footer: Theme & User */}
        <div className="border-t px-3 py-3 space-y-2">
          <div className="flex items-center justify-between px-2 gap-2">
            {expanded && (
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Tema
              </span>
            )}
            <ThemeToggle />
          </div>
          {user && (
            <div className="flex items-center justify-center lg:justify-start px-2">
              <UserMenu user={user} />
            </div>
          )}
          {expanded && (
            <div className="border-t pt-2 px-2 text-[11px] text-muted-foreground flex items-center justify-between">
              <span>B2C Finance</span>
              <span className="text-primary font-medium">by B2C</span>
            </div>
          )}
        </div>
      </aside>

      {/* Tablet/Mobile: Toggle Button (visible on md and below lg) */}
      <div className="lg:hidden flex items-center">
        <button
          onClick={toggleMobileOpen}
          className="p-2 h-10 w-10 flex items-center justify-center rounded hover:bg-accent hover:text-accent-foreground transition-colors ml-auto"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile/Tablet Drawer Sidebar */}
      {mobileOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={closeMobileMenu}
            role="presentation"
          />

          {/* Drawer */}
          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 w-72 flex flex-col border-r bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/60 sidebar-collapse",
              mobileOpen && "animate-in slide-in-from-left"
            )}
            style={{ paddingTop: "var(--safe-area-inset-top, 0)" }}
          >
            {/* Header with Close Button */}
            <div className="border-b px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-end gap-2">
                  <B2CLogo height={30} />
                  <div className="pb-0.5">
                    <h1 className="text-lg font-semibold tracking-tight leading-none text-foreground">
                      Finance
                    </h1>
                  </div>
                </div>
                <button
                  onClick={closeMobileMenu}
                  className="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                  aria-label="Close sidebar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1.5">
                Gestão financeira
              </p>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
              {visibleItems.map((it, i) => {
                const Icon = it.icon;
                const active = pathname === it.href || pathname?.startsWith(it.href + "/");
                const newSection = it.section && it.section !== visibleItems[i - 1]?.section;

                return (
                  <div key={it.href}>
                    {newSection && (
                      <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                        {it.section}
                      </p>
                    )}
                    <Link
                      href={it.href}
                      onClick={closeMobileMenu}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 min-h-touch",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-0.5"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-5 w-5 transition-transform duration-200",
                          active ? "" : "group-hover:scale-110"
                        )}
                      />
                      <span>{it.label}</span>
                    </Link>
                  </div>
                );
              })}
            </nav>

            {/* Footer */}
            <div className="border-t px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Tema
                </span>
                <ThemeToggle />
              </div>
              {user && <UserMenu user={user} />}
              <div className="border-t pt-3 text-[11px] text-muted-foreground flex items-center justify-between">
                <span>B2C Finance</span>
                <span className="text-primary font-medium">by B2C Gestão</span>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
