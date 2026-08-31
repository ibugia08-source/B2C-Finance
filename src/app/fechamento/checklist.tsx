import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, CircleSlash, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ItemChecklist } from "@/lib/services/closing-checklist";

/**
 * Os 16 itens de 01 §5.3, cada um com dono e link.
 *
 * Componente de SERVIDOR de propósito: é uma lista de leitura, sem gesto
 * nenhum. Torná-la cliente só mandaria JavaScript à toa para o navegador.
 */
const VISUAL = {
  OK: { Icone: Check, classe: "bg-success-soft text-success", rotulo: "Conferido" },
  PENDENTE: { Icone: AlertTriangle, classe: "bg-warning-soft text-warning", rotulo: "Pendente" },
  NAO_MEDIDO: { Icone: Clock, classe: "bg-surface-sunken text-text-faint", rotulo: "Ainda não medido" },
  NAO_SE_APLICA: { Icone: CircleSlash, classe: "bg-surface-sunken text-text-faint", rotulo: "Não se aplica" },
} as const;

export function ChecklistFechamento({ itens }: { itens: ItemChecklist[] }) {
  return (
    <ol className="divide-y divide-border-soft">
      {itens.map((item) => {
        const v = VISUAL[item.situacao];
        const Icone = v.Icone;
        return (
          <li key={item.id} className="flex flex-wrap items-start gap-3 p-3.5">
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${v.classe}`}
              aria-hidden
            >
              <Icone className="h-3.5 w-3.5" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-body font-medium">
                <span className="text-muted-foreground">{item.numero}. </span>
                {item.titulo}
              </p>
              <p className="mt-0.5 text-dense text-muted-foreground">{item.detalhe}</p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {item.dono !== "—" ? (
                <Badge variant="outline" className="text-[10px]">
                  {item.dono}
                </Badge>
              ) : null}
              <Badge
                variant={
                  item.situacao === "OK"
                    ? "success"
                    : item.situacao === "PENDENTE"
                      ? "warning"
                      : "outline"
                }
                className="text-[10px]"
              >
                {v.rotulo}
              </Badge>
              {item.href && item.situacao === "PENDENTE" ? (
                <Link
                  href={item.href}
                  className="inline-flex items-center gap-1 text-dense text-brand hover:underline"
                >
                  Resolver
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
