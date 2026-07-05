import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Abas do hub de cobranças — unifica Cobranças, Pagamentos e Inadimplência
 * em uma experiência única (rotas preservadas, navegação em 1 clique).
 */
const TABS = [
  { href: "/cobrancas", label: "Cobranças" },
  { href: "/pagamentos", label: "Pagamentos" },
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
