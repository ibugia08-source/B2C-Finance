"use client";
import { useState } from "react";
import { Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getMetricSpec,
  type MetricSpec,
  type MetricDateBasis,
  type MetricGrain,
} from "@/lib/metrics/registry";
import type { TemporalBasis } from "@/components/metric-card";
import { cn } from "@/lib/utils";

/**
 * "COMO ESTE VALOR FOI CALCULADO" — DA-01 da auditoria de 11/09/2026.
 *
 * O relatório encontrou três números chamados "Faturamento" com três valores
 * (R$ 51.596, R$ 51.956 e R$ 50.756) e dois chamados "projeção 30 dias" com
 * dois. Nenhum deles estava errado: são métricas DIFERENTES, com bases
 * temporais diferentes, e o METRIC_REGISTRY já dizia isso desde sempre —
 * só que nenhuma tela o consumia. O usuário via três valores e um nome.
 *
 * Este componente é a ponte que faltava. Ele não recalcula nada e não guarda
 * texto próprio: lê o contrato da métrica (fórmula, grão, base temporal,
 * entidades de origem, filtros, arredondamento, política de nulo e versão) e
 * mostra. Quando a fórmula mudar, nasce a versão 2 no registry e esta caixa
 * passa a explicar a nova sem que ninguém edite a interface.
 *
 * Aceite da DA-01: "cada KPI permite abrir a composição; diferenças legítimas
 * são explicadas antes de serem interpretadas como erro."
 */

const GRAO_LABEL: Record<MetricGrain, string> = {
  COMPETENCE: "Uma competência (mês de resultado)",
  PERIOD: "Um período livre",
  POINT_IN_TIME: "Uma foto do momento — não tem período",
  CLIENT: "Um cliente",
};

const BASE_LABEL: Record<MetricDateBasis, string> = {
  COMPETENCE: "Competência — o mês a que o resultado pertence",
  CASH: "Caixa — o dia em que o dinheiro entrou ou saiu",
  CURRENT_STATE: "Estado atual — o que vale agora, não um período",
  SNAPSHOT: "Fotografia — o valor congelado no fechamento",
};

/** Base do registry → selo do card. CURRENT_STATE não tem selo: não é período. */
export function basisDoRegistry(key: string): TemporalBasis | undefined {
  switch (getMetricSpec(key)?.dateBasis) {
    case "COMPETENCE":
      return "competencia";
    case "CASH":
      return "caixa";
    case "SNAPSHOT":
      return "fotografia";
    default:
      return undefined;
  }
}

/** Nome oficial da métrica — evita dois KPIs distintos com o mesmo rótulo. */
export function nomeDaMetrica(key: string): string | undefined {
  return getMetricSpec(key)?.name;
}

function Linha({ termo, children }: { termo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 border-t border-border-soft py-2.5 sm:grid-cols-[9.5rem_1fr] sm:gap-3">
      <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {termo}
      </dt>
      <dd className="text-dense text-foreground">{children}</dd>
    </div>
  );
}

/** Conteúdo da explicação — reaproveitável dentro de outro modal. */
export function ComposicaoDaMetrica({
  spec,
  composicao,
}: {
  spec: MetricSpec;
  /** Linhas de origem do valor exibido, quando a tela souber abri-las. */
  composicao?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-body text-muted-foreground">{spec.description}</p>

      <dl className="mt-3">
        <Linha termo="Como é somado">{spec.formulaDescription}</Linha>
        <Linha termo="Base temporal">{BASE_LABEL[spec.dateBasis]}</Linha>
        <Linha termo="Grão">{GRAO_LABEL[spec.grain]}</Linha>
        {spec.filters && <Linha termo="Inclui / exclui">{spec.filters}</Linha>}
        <Linha termo="Origem dos dados">{spec.sourceEntities.join(", ")}</Linha>
        {spec.rounding && <Linha termo="Arredondamento">{spec.rounding}</Linha>}
        {spec.nullPolicy && <Linha termo="Quando não dá">{spec.nullPolicy}</Linha>}
        <Linha termo="Versão da fórmula">
          v{spec.version ?? 1}
          {spec.vigenteAte ? ` · valeu até ${spec.vigenteAte}` : " · vigente"}
          <span className="text-muted-foreground"> · definição em {spec.spec}</span>
        </Linha>
      </dl>

      {composicao && (
        <div className="mt-4 border-t border-border-soft pt-3">
          <p className="mb-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            Linhas que compõem este valor
          </p>
          {composicao}
        </div>
      )}

      <p className="mt-4 rounded-card bg-surface-soft px-3 py-2 text-caption text-muted-foreground">
        Dois números com nomes parecidos podem ser métricas diferentes e os dois
        estarem certos — o que os separa é a base temporal acima.
      </p>
    </div>
  );
}

/**
 * Botão discreto que abre a composição. Alvo de 24 px (WCAG 2.5.8) mesmo com
 * o ícone desenhado em 14 px — a auditoria pediu revisão justamente disso.
 */
export function MetricExplainer({
  metrica,
  composicao,
  className,
}: {
  /** Chave do METRIC_REGISTRY. Chave desconhecida não renderiza nada. */
  metrica: string;
  composicao?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const spec = getMetricSpec(metrica);
  if (!spec) return null;

  return (
    <>
      <button
        type="button"
        aria-label={`Como ${spec.name} é calculado`}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          "text-muted-foreground/70 transition-colors duration-fast",
          "hover:bg-surface-soft hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Como {spec.name} é calculado</DialogTitle>
          </DialogHeader>
          <ComposicaoDaMetrica spec={spec} composicao={composicao} />
        </DialogContent>
      </Dialog>
    </>
  );
}
