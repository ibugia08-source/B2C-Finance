"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { B2CLogo } from "./mascot";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { visibleAreas, areaOfPath, type UserLike } from "./nav-items";

/**
 * CASCA DO B2C FINANCE 2 — barra superior (substitui a sidebar).
 *
 * Linha 1 (desktop): marca · espaços de trabalho (Hoje · Clientes ·
 * Financeiro · Comercial) · tema · Sistema · usuário.
 * Linha 2 (todas as larguras): subnav do espaço ativo — abas sublinhadas
 * com as páginas dele, preservando ?mes= (trocar de visão não é trocar
 * de mês). No mobile a linha 1 é o MobileHeader (renderizado pelo shell).
 */
export function SiteHeader({ user }: { user: UserLike }) {
  const pathname = usePathname() ?? "";
  const sp = useSearchParams();
  const mes = sp.get("mes");

  const areas = visibleAreas(user);
  const active = areaOfPath(areas, pathname);
  const workspaces = areas.filter((a) => a.key !== "sistema");
  const sistema = areas.find((a) => a.key === "sistema");

  const withMes = (href: string) => (mes ? `${href}?mes=${mes}` : href);

  return (
    <>
      {/* Linha 1 — só desktop (no mobile o MobileHeader cumpre o papel) */}
      <div className="hidden lg:block border-b border-border-soft">
        <div className="mx-auto flex h-14 w-full max-w-[1560px] items-center gap-6 px-6">
          <Link
            href="/dashboard"
            className="flex shrink-0 items-end gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          >
            <B2CLogo height={26} />
            <span className="font-display text-lg font-semibold tracking-tight leading-none text-foreground pb-0.5">
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
                    "rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {area.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {sistema && (
              <Link
                href={sistema.href}
                title="Sistema"
                aria-label="Sistema"
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

      {/* Linha 2 — subnav do espaço ativo (todas as larguras) */}
      {active && active.pages.length > 1 && (
        <div className="overflow-x-auto">
          <nav
            className="mx-auto flex w-full max-w-[1560px] items-stretch gap-1 px-3 lg:px-6"
            aria-label={`Páginas de ${active.label}`}
          >
            {active.pages.map((p) => {
              const pageActive = pathname === p.href || pathname.startsWith(p.href + "/");
              return (
                <Link
                  key={p.href}
                  href={withMes(p.href)}
                  className={cn(
                    "whitespace-nowrap border-b-2 px-3 pt-2 pb-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    pageActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  )}
                >
                  {p.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}
