"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { BrandLogoCompact } from "./brand";
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
 *
 * Sem `title`, a faixa mostra a ASSINATURA COMPACTA da marca (símbolo +
 * B2C, 112 × 28) em vez do nome escrito: é a variante que o manual pede
 * para o celular, e o nome acessível continua sendo "B2C Finance".
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
      {!title && (
        <Link
          href="/dashboard"
          aria-label="B2C Finance — ir para a Visão geral"
          className="flex flex-1 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandLogoCompact height={26} />
        </Link>
      )}
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
