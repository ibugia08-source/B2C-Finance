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
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

const STORAGE_KEY = "b2c:sidebar:state";

export function SidebarWithToggle({
  user,
  defaultExpanded = false,
  responsive = true,
  mobileVariant = "drawer",
  onStateChange,
  mobileOpen: controlledMobileOpen,
  onMobileOpenChange,
}: SidebarWithToggleProps) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isClient, setIsClient] = useState(false);
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);

  // Use controlled state if provided, otherwise use internal state
  const mobileOpen = controlledMobileOpen ?? internalMobileOpen;
  const setMobileOpen = (open: boolean) => {
    setInternalMobileOpen(open);
    onMobileOpenChange?.(open);
  };

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

  // Renderiza já no SSR (estado padrão) — evita a sidebar "pipocar" após a
  // hidratação e o layout shift em toda carga de página.

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
        {/* Header with Logo & Toggle.
            Recolhida (w-20 = 80px): logo e botão EMPILHADOS e centralizados —
            lado a lado o wordmark (64px) + botão (32px) não cabem e o logo
            vazava por cima do hambúrguer. */}
        <div className={cn("border-b", expanded ? "px-4 py-4 lg:px-6 lg:py-5" : "px-2 py-4")}>
          <div
            className={cn(
              "flex items-center gap-2",
              expanded ? "justify-between" : "flex-col justify-center gap-2.5"
            )}
          >
            {expanded ? (
              <div className="flex items-end gap-2 flex-1 min-w-0">
                <B2CLogo height={30} />
                <div className="pb-0.5">
                  <h1 className="text-lg font-semibold tracking-tight leading-none text-foreground">
                    Finance
                  </h1>
                </div>
              </div>
            ) : (
              <B2CLogo height={16} />
            )}
            <button
              onClick={toggleExpand}
              className="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={expanded ? "Recolher menu" : "Expandir menu"}
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
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
                    "min-h-touch justify-center lg:justify-start",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                  title={!expanded ? it.label : undefined}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {expanded && <span className="flex-1">{it.label}</span>}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Footer: Theme & User.
            Recolhida (80px): tudo empilhado e centralizado — o toggle de tema
            horizontal (~92px) e o UserMenu completo (~250px) vazavam da barra. */}
        {expanded ? (
          <div className="border-t px-3 py-3 space-y-2">
            <div className="flex items-center justify-between px-2 gap-2">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Tema
              </span>
              <ThemeToggle />
            </div>
            {user && (
              <div className="flex items-center justify-start px-2">
                <UserMenu user={user} />
              </div>
            )}
            <div className="border-t pt-2 px-2 text-[11px] text-muted-foreground flex items-center justify-between">
              <span>B2C Finance</span>
              <span className="text-primary font-medium">by B2C</span>
            </div>
          </div>
        ) : (
          <div className="border-t px-2 py-3 flex flex-col items-center gap-3">
            <ThemeToggle orientation="vertical" />
            {user && <UserMenu user={user} compact />}
          </div>
        )}
      </aside>

      {/* Tablet (< lg): o menu abre pelo hambúrguer do MobileHeader — sem
          botão órfão flutuando entre a sidebar e o conteúdo. */}

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
                  className="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Fechar menu"
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
                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 min-h-touch",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Icon className="h-5 w-5" />
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
