import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Abas do módulo CLIENTES (unificado): a carteira de clientes, a visão
 * mensal de recebimentos e a inadimplência — tudo sob o mesmo módulo.
 * Cadastro de cliente é só na aba Clientes. Acordos/contratos ficam FORA.
 */
const TABS = [
  { href: "/clientes", label: "Clientes" },
  { href: "/cobrancas", label: "Recebimentos" },
  { href: "/inadimplencia", label: "Inadimplência" },
];

export function CobrancasTabs({ active }: { active: string }) {
  return (
    <div className="mb-4 inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
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
