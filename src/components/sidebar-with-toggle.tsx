"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { B2CLogo } from "./mascot";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import {
  visibleAreas,
  areaOfPath,
  type UserLike,
  type VisibleArea,
} from "./nav-items";

interface SidebarWithToggleProps {
  user: UserLike;
  defaultExpanded?: boolean;
  responsive?: boolean;
  mobileVariant?: "drawer" | "bottom-sheet";
  onStateChange?: (expanded: boolean) => void;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

// v2: a reconstrução por áreas abre a sidebar por padrão (o rail de ícones
// era críptico como estado inicial). Chave nova para todo mundo pegar o novo
// padrão uma vez; a preferência volta a persistir a partir daí.
const STORAGE_KEY = "b2c:sidebar:state:v2";

export function SidebarWithToggle({
  user,
  defaultExpanded = true,
  responsive = true,
  mobileVariant = "drawer",
  onStateChange,
  mobileOpen: controlledMobileOpen,
  onMobileOpenChange,
}: SidebarWithToggleProps) {
  const pathname = usePathname() ?? "";
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isClient, setIsClient] = useState(false);
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);
  // Áreas abertas manualmente (além da área ativa, que abre sozinha).
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  const mobileOpen = controlledMobileOpen ?? internalMobileOpen;
  const setMobileOpen = (open: boolean) => {
    setInternalMobileOpen(open);
    onMobileOpenChange?.(open);
  };

  // Hydrate from localStorage
  useEffect(() => {
    setIsClient(true);
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setExpanded(stored === "true");
    else setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  useEffect(() => {
    if (isClient) {
      localStorage.setItem(STORAGE_KEY, expanded.toString());
      onStateChange?.(expanded);
    }
  }, [expanded, isClient, onStateChange]);

  const areas = visibleAreas(user);
  const activeArea = areaOfPath(areas, pathname);

  const toggleArea = (key: string) =>
    setOpenKeys((keys) =>
      keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]
    );

  const closeMobileMenu = () => setMobileOpen(false);

  /** Lista de áreas (modo expandido) — compartilhada entre desktop e drawer.
   *  Função de render (não componente): evita remontar a subárvore a cada
   *  render, o que derrubaria o foco de teclado nos links. */
  const renderAreaList = (onNavigate?: () => void) => (
    <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
      {areas.map((area) => {
        const Icon = area.icon;
        const isActive = activeArea?.key === area.key;
        const open = isActive || openKeys.includes(area.key);
        const hasChildren = area.pages.length > 1;
        return (
          <div key={area.key}>
            <div
              className={cn(
                "group flex items-center rounded-lg transition-colors duration-150",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Link
                href={area.href}
                onClick={onNavigate}
                className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium min-h-touch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className="flex-1">{area.label}</span>
              </Link>
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => toggleArea(area.key)}
                  aria-label={open ? `Recolher ${area.label}` : `Expandir ${area.label}`}
                  aria-expanded={open}
                  className={cn(
                    "mr-1 h-8 w-8 flex items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "hover:bg-primary-foreground/15"
                      : "hover:bg-accent"
                  )}
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      open && "rotate-180"
                    )}
                  />
                </button>
              )}
            </div>

            {hasChildren && open && (
              <div className="mt-1 mb-1.5 ml-[1.4rem] border-l border-border-soft pl-3 space-y-0.5">
                {area.pages.map((p) => {
                  const pageActive =
                    pathname === p.href || pathname.startsWith(p.href + "/");
                  return (
                    <Link
                      key={p.href}
                      href={p.href}
                      onClick={onNavigate}
                      className={cn(
                        "block rounded-md px-2.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        pageActive
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      )}
                    >
                      {p.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:flex-col lg:border-r lg:bg-card/60 lg:backdrop-blur lg:supports-[backdrop-filter]:bg-card/60 sidebar-collapse",
          expanded ? "lg:w-64" : "lg:w-20"
        )}
      >
        {/* Cabeçalho: logo + alternar. Recolhida (80px): empilhados. */}
        <div className={cn("border-b", expanded ? "px-4 py-4" : "px-2 py-4")}>
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
              onClick={() => setExpanded(!expanded)}
              className="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={expanded ? "Recolher menu" : "Expandir menu"}
            >
              {expanded ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Navegação */}
        {expanded ? (
          renderAreaList()
        ) : (
          // Rail de ícones: uma entrada por ÁREA (6, não 20).
          <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
            {areas.map((area) => {
              const Icon = area.icon;
              const isActive = activeArea?.key === area.key;
              return (
                <Link
                  key={area.key}
                  href={area.href}
                  title={area.label}
                  className={cn(
                    "flex items-center justify-center rounded-lg px-3 py-2 min-h-touch transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </Link>
              );
            })}
          </nav>
        )}

        {/* Rodapé: tema + usuário */}
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
          </div>
        ) : (
          <div className="border-t px-2 py-3 flex flex-col items-center gap-3">
            <ThemeToggle orientation="vertical" />
            {user && <UserMenu user={user} compact />}
          </div>
        )}
      </aside>

      {/* Mobile/Tablet Drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={closeMobileMenu}
            role="presentation"
          />
          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 w-72 flex flex-col border-r bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 sidebar-collapse",
              mobileOpen && "animate-in slide-in-from-left"
            )}
            style={{ paddingTop: "var(--safe-area-inset-top, 0)" }}
          >
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
            </div>

            {renderAreaList(closeMobileMenu)}

            <div className="border-t px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Tema
                </span>
                <ThemeToggle />
              </div>
              {user && <UserMenu user={user} />}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
