import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Primitivos para exibir "linhas de tabela" como cards no mobile.
 * Padrão de uso por página:
 *   <div className="hidden md:block"> ...<Table/>... </div>   // desktop
 *   <MobileCards> {rows.map(r => <MobileCard>…</MobileCard>)} </MobileCards>  // mobile
 *
 * MobileCards já é `md:hidden`, então some no desktop automaticamente.
 */

export function MobileCards({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("md:hidden space-y-2.5 p-3", className)} {...props}>
      {children}
    </div>
  );
}

export function MobileCard({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border bg-card/40 p-3.5 space-y-2.5", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Topo do card: título à esquerda (trunca) e um destaque à direita (valor/badge). */
export function MobileCardHeader({
  title,
  aside,
  className,
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0 break-words font-medium leading-snug">{title}</div>
      {aside != null && (
        <div className="shrink-0 text-right leading-snug">{aside}</div>
      )}
    </div>
  );
}

/** Par rótulo/valor em linha (rótulo à esquerda, valor à direita). */
export function Field({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 text-[13px]", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
}

/** Rodapé do card com as ações (editar/excluir/etc.), alinhadas à direita. */
export function MobileCardActions({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-1 border-t pt-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Estado vazio padrão para as listas em card no mobile. */
export function MobileEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
