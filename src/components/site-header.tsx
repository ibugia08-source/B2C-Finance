"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, Search, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { B2CLogo } from "./mascot";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { MonthNav } from "./month-nav";
import { ScopeSelector } from "./scope-selector";
import { Kbd, openPalette } from "./command-palette";
import { visibleAreas, areaOfPath, type UserLike } from "./nav-items";
import { mesAtual, parseMes, rotaTemMes } from "@/lib/month-param";
import type { ScopeOptions } from "@/lib/services/org-scope";

/**
 * BARRA GLOBAL (F1.14 · ref. 02 §2).
 *
 * "Barra superior global: MonthNav + seletor de escopo (Todas |
 * EntidadeLegal | Agência) + Busca global + atalho da paleta."
 *
 * Três faixas:
 *  1. marca · espaços de trabalho · busca · tema · sistema · usuário
 *     (só no desktop; no mobile o MobileHeader cumpre o papel)
 *  2. subnav do espaço ativo, preservando ?mes= — trocar de visão não é
 *     trocar de mês
 *  3. barra de CONTEXTO (MonthNav + escopo), só nas telas por
 *     competência. O MonthNav saiu das seis páginas que o desenhavam por
 *     conta própria: ele mudava de lugar conforme a tela, e agora fica
 *     sempre no mesmo canto.
 */
export function SiteHeader({
  user,
  scopeOptions,
  naoLidas = 0,
}: {
  user: UserLike;
  scopeOptions: ScopeOptions;
  naoLidas?: number;
}) {
  const pathname = usePathname() ?? "";
  const sp = useSearchParams();
  const mes = sp.get("mes");

  const areas = visibleAreas(user);
  const active = areaOfPath(areas, pathname);
  const workspaces = areas.filter((a) => a.key !== "sistema");
  const sistema = areas.find((a) => a.key === "sistema");

  const withMes = (href: string) => (mes ? `${href}?mes=${mes}` : href);
  const comMes = rotaTemMes(pathname);
  const mesSel = parseMes(mes) ?? mesAtual();

  return (
    <>
      {/* Faixa 1 — desktop */}
      <div className="hidden border-b border-border-soft lg:block">
        <div className="mx-auto flex h-14 w-full max-w-content items-center gap-6 px-6">
          <Link
            href="/dashboard"
            className="flex shrink-0 items-end gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <B2CLogo height={26} />
            <span className="pb-0.5 text-lg font-semibold leading-none tracking-tight text-foreground">
              Finance
            </span>
          </Link>

          <nav className="flex items-center gap-1" aria-label="Espaços de trabalho">
            {workspaces.map((area) => {
              const isActive = active?.key === area.key;
              return (
                <Link
                  key={area.key}
                  href={area.href}
                  className={cn(
                    "rounded-pill px-4 py-1.5 text-body font-medium transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {area.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => openPalette("search")}
              className="flex h-9 items-center gap-2 rounded-pill border bg-background px-3 text-body text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="h-4 w-4" aria-hidden />
              <span>Buscar</span>
              <Kbd>⌘K</Kbd>
            </button>
            <ThemeToggle />
            <Link
              href="/notificacoes"
              title="Notificações"
              aria-label={
                naoLidas > 0
                  ? `Notificações — ${naoLidas} não ${naoLidas === 1 ? "lida" : "lidas"}`
                  : "Notificações"
              }
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-pill transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                pathname.startsWith("/notificacoes")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden />
              {naoLidas > 0 && (
                <span
                  aria-hidden
                  className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
                >
                  {naoLidas > 9 ? "9+" : naoLidas}
                </span>
              )}
            </Link>
            {sistema && (
              <Link
                href={sistema.href}
                title="Sistema"
                aria-label="Sistema"
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-pill transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active?.key === "sistema"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Settings2 className="h-[18px] w-[18px]" />
              </Link>
            )}
            {user && <UserMenu user={user} compact />}
          </div>
        </div>
      </div>

      {/* Faixa 2 — subnav do espaço ativo */}
      {active && active.pages.length > 1 && (
        <div
          className="overflow-x-auto"
          style={{
            WebkitMaskImage:
              "linear-gradient(to right, black calc(100% - 28px), transparent)",
            maskImage: "linear-gradient(to right, black calc(100% - 28px), transparent)",
          }}
        >
          <nav
            className="mx-auto flex w-full max-w-content items-stretch gap-1 px-3 lg:px-6"
            aria-label={`Páginas de ${active.label}`}
          >
            {active.pages.map((p) => {
              const pageActive = pathname === p.href || pathname.startsWith(p.href + "/");
              return (
                <Link
                  key={p.href}
                  href={withMes(p.href)}
                  className={cn(
                    "whitespace-nowrap border-b-2 px-3 pb-1.5 pt-2 text-dense font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    pageActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  {p.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* Faixa 3 — contexto: mês e escopo (só nas telas por competência) */}
      {comMes && (
        <div className="border-t border-border-soft bg-surface-soft/60">
          <div className="mx-auto flex w-full max-w-content flex-wrap items-center justify-end gap-2 px-3 py-2 lg:px-6">
            <ScopeSelector options={scopeOptions} />
            <MonthNav month={mesSel.month} year={mesSel.year} />
          </div>
        </div>
      )}
    </>
  );
}
