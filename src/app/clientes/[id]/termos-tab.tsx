import { History, TrendingDown, TrendingUp, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * HISTÓRICO DE PREÇO E TERMOS (F1.16 · ref. 02 §4.1).
 *
 * É a tela que só passou a ser possível depois da F1.2. Antes, o valor
 * morava num campo do cliente e o reajuste SOBRESCREVIA o passado — não
 * havia histórico para mostrar, porque não havia histórico guardado.
 *
 * Cada linha é um termo com sua vigência. A variação entre um termo e o
 * anterior é calculada e exibida com sinal e cor: é a pergunta que se faz
 * olhando esta tela ("quanto ele subiu?"), e obrigar a fazer a conta de
 * cabeça seria devolver o trabalho ao usuário.
 */

export type TermoLinha = {
  id: string;
  modality: string;
  monthlyValue: number | null;
  totalContractValue: number | null;
  contractMonths: number | null;
  validFrom: string;
  validTo: string | null;
  reason: string | null;
};

export type GestorLinha = {
  id: string;
  nome: string;
  role: string;
  validFrom: string;
  validTo: string | null;
  reason: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  MANAGER_1: "Gestor principal",
  MANAGER_2: "Gestor de apoio",
  COMMERCIAL_ORIGIN: "Responsável comercial",
  SDR_ORIGIN: "SDR de origem",
};

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** Valor de referência do termo: mensal no MRR, total no TCV. */
function valorDe(t: TermoLinha): number {
  return t.modality === "TCV" ? (t.totalContractValue ?? 0) : (t.monthlyValue ?? 0);
}

export function TermosTab({
  termos,
  gestores,
}: {
  termos: TermoLinha[];
  gestores: GestorLinha[];
}) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-section">Histórico de preço</h2>
        {termos.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nenhum termo registrado"
            description="O termo comercial guarda o que foi combinado e desde quando. Ele nasce no cadastro do cliente e a cada reajuste."
          />
        ) : (
          <div className="overflow-hidden rounded-card border">
            {termos.map((t, i) => {
              // Do mais recente para o mais antigo: o "anterior" está ABAIXO.
              const anterior = termos[i + 1];
              const atual = valorDe(t);
              const antes = anterior ? valorDe(anterior) : null;
              const delta = antes != null && antes > 0 ? (atual - antes) / antes : null;
              const vigente = t.validTo === null;

              return (
                <div key={t.id} className={cn("px-4 py-3", i > 0 && "border-t", vigente && "bg-success-soft/30")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span className="stat-number text-emphasis font-semibold">
                        {formatBRL(atual)}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {t.modality === "TCV" ? "total do contrato" : "por mês"}
                      </span>
                      <Badge variant={t.modality === "TCV" ? "secondary" : "default"}>
                        {t.modality}
                      </Badge>
                      {vigente && <Badge variant="success">vigente</Badge>}
                    </div>
                    {delta != null && delta !== 0 && (
                      <span
                        className={cn(
                          "flex items-center gap-1 text-caption font-medium",
                          delta > 0 ? "text-success" : "text-destructive"
                        )}
                      >
                        {delta > 0 ? (
                          <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {delta > 0 ? "+" : "−"}
                        {Math.abs(delta * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {data(t.validFrom)} — {t.validTo ? data(t.validTo) : "hoje"}
                    {t.contractMonths ? ` · ${t.contractMonths} meses` : ""}
                    {t.reason ? ` · ${t.reason}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-section">Quem respondeu pela conta</h2>
        {gestores.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nenhuma atribuição registrada"
            description="A vigência de gestores guarda quem cuidava do cliente em cada período — é o que permite apurar carteira e comissão sobre o passado."
          />
        ) : (
          <div className="overflow-hidden rounded-card border">
            {gestores.map((g, i) => (
              <div
                key={g.id}
                className={cn(
                  "flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5",
                  i > 0 && "border-t",
                  g.validTo === null && "bg-success-soft/30"
                )}
              >
                <div>
                  <span className="text-body font-medium">{g.nome}</span>
                  <span className="ml-2 text-caption text-muted-foreground">
                    {ROLE_LABEL[g.role] ?? g.role}
                  </span>
                </div>
                <span className="text-caption text-muted-foreground">
                  {data(g.validFrom)} — {g.validTo ? data(g.validTo) : "hoje"}
                  {g.reason ? ` · ${g.reason}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
