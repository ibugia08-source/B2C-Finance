import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { MetricHelp } from "@/components/dashboard/metric-help";
import { cn } from "@/lib/utils";

/**
 * Card de métrica do módulo Clientes — mesmo padrão visual dos cards da
 * Dashboard: clicável (aplica filtro na própria lista), ícone "?" no canto
 * superior direito com tooltip explicando a métrica, visual flat/limpo.
 * O ícone de ajuda fica FORA do Link (posicionado por cima) para o tooltip
 * não disparar a navegação.
 */
export function KpiCard({
  title,
  value,
  hint,
  help,
  href,
  tone = "default",
}: {
  title: string;
  value: string;
  hint?: string;
  help: string;
  href: string;
  tone?: "default" | "pos" | "neg" | "warn";
}) {
  const color =
    tone === "pos" ? "text-success"
      : tone === "neg" ? "text-destructive"
      : tone === "warn" ? "text-warning"
      : "text-foreground";

  return (
    <Card className="relative transition-shadow hover:shadow-md">
      <div className="absolute right-3 top-3 z-10">
        <MetricHelp title={title} text={help} />
      </div>
      <Link
        href={href}
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardContent className="p-4 pr-9">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            {title}
          </p>
          <p className={cn("text-xl 2xl:text-2xl font-semibold stat-number mt-1.5 whitespace-nowrap", color)}>{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground mt-1 truncate">{hint}</p>}
        </CardContent>
      </Link>
    </Card>
  );
}
