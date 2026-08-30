"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Abas da Gestão do Mês: planilha mensal de recebimentos + inadimplência.
 * (Clientes virou ÁREA própria na navegação — saiu daqui para não haver
 * dois caminhos concorrentes para a mesma tela.)
 */
const TABS = [
  { href: "/cobrancas", label: "Recebimentos" },
  { href: "/inadimplencia", label: "Inadimplência" },
];

export function CobrancasTabs({
  active,
  showInadimplencia = true,
}: {
  active: string;
  /** Sem recebimentos.ver_inadimplencia a aba nem aparece (não expulsa). */
  showInadimplencia?: boolean;
}) {
  const tabs = showInadimplencia
    ? TABS
    : TABS.filter((t) => t.href !== "/inadimplencia");
  // Preserva a competência ao trocar de aba (trocar de visão não é trocar de mês).
  const sp = useSearchParams();
  const mes = sp.get("mes");
  const withMes = (href: string) => (mes ? `${href}?mes=${mes}` : href);
  return (
    <div className="mb-4 inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={withMes(t.href)}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            active === t.href
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
