/**
 * Projeções e simulação de cenários — funções PURAS (sem banco).
 * O baseline vem da camada central de cálculos (revenue/expense metrics);
 * aqui só existe aritmética de cenário + análise de gap + narrativa.
 * Compartilhado entre server (baseline) e client (simulador ao vivo).
 */

export type Baseline = {
  // Receita (competência MRR/TCV do mês)
  receita: number;
  mrr: number;
  tcv: number;
  mrrClients: number;
  avgTicketMrr: number; // ticket médio MRR (p/ converter gap em nº de clientes)
  avgTicketTcv: number; // última média de TCV (p/ converter gap em nº de vendas)
  // Despesas do mês (transações) + folha
  despesas: number;
  despesasRecorrentes: number;
  folha: number;
  // Recuperável / pipeline
  inadimplenciaAberta: number; // vencido em aberto (recuperável)
  upsellPipeline: number; // valor em oportunidades abertas
  // Caixa
  caixa: number;
  projecao30: number;
};

export type ScenarioInput = {
  aumentoMrr: number; // R$ de MRR novo por mês
  aumentoTcv: number; // R$ de TCV no mês
  reducaoDespesas: number; // R$ de corte
  aumentoUpsell: number; // R$ de upsell vendido
  perdaClientesMrr: number; // nº de clientes MRR perdidos (simulação)
  recuperacaoInadimplencia: number; // R$ recuperado
  aumentoFolha: number; // R$ de contratação/aumento
};

export type Goals = {
  metaFaturamento: number | null;
  margemDesejada: number | null; // % (0-100)
  metaLucro: number | null;
};

export type Projected = {
  receita: number;
  despesas: number; // inclui folha
  lucro: number;
  margem: number; // % (0-100)
};

export const EMPTY_SCENARIO: ScenarioInput = {
  aumentoMrr: 0,
  aumentoTcv: 0,
  reducaoDespesas: 0,
  aumentoUpsell: 0,
  perdaClientesMrr: 0,
  recuperacaoInadimplencia: 0,
  aumentoFolha: 0,
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Cenário atual (sem simulação): receita/lucro/margem do baseline. */
export function currentScenario(b: Baseline): Projected {
  const despesas = b.despesas + b.folha;
  const lucro = b.receita - despesas;
  return {
    receita: r2(b.receita),
    despesas: r2(despesas),
    lucro: r2(lucro),
    margem: b.receita > 0 ? r2((lucro / b.receita) * 100) : 0,
  };
}

/** Aplica o cenário simulado sobre o baseline. */
export function projectScenario(b: Baseline, s: ScenarioInput): Projected {
  const perdaMrr = s.perdaClientesMrr * b.avgTicketMrr;
  const receita = Math.max(
    0,
    b.receita +
      s.aumentoMrr +
      s.aumentoTcv +
      s.aumentoUpsell +
      s.recuperacaoInadimplencia -
      perdaMrr
  );
  const despesas = Math.max(0, b.despesas + b.folha - s.reducaoDespesas + s.aumentoFolha);
  const lucro = receita - despesas;
  return {
    receita: r2(receita),
    despesas: r2(despesas),
    lucro: r2(lucro),
    margem: receita > 0 ? r2((lucro / receita) * 100) : 0,
  };
}

export type GapAnalysis = {
  gapFaturamento: number | null; // falta até a meta (0 = atingida)
  gapLucro: number | null;
  gapMargem: number | null; // pontos percentuais
  // Quanto precisa mudar para atingir a MARGEM desejada (a partir do projetado)
  aumentoReceitaNecessario: number | null;
  reducaoDespesasNecessaria: number | null;
  // Conversões práticas
  novosMrrsNecessarios: number | null; // nº de clientes MRR (ticket médio)
  tcvsNecessarios: number | null; // nº de vendas TCV (ticket médio)
  upsellNecessario: number | null; // R$ (limitado ao pipeline)
  inadimplenciaARecuperar: number | null; // R$ (limitado ao vencido)
};

export function analyzeGaps(b: Baseline, p: Projected, g: Goals): GapAnalysis {
  const gapFaturamento =
    g.metaFaturamento != null ? Math.max(0, r2(g.metaFaturamento - p.receita)) : null;
  const gapLucro = g.metaLucro != null ? Math.max(0, r2(g.metaLucro - p.lucro)) : null;
  const gapMargem =
    g.margemDesejada != null ? Math.max(0, r2(g.margemDesejada - p.margem)) : null;

  // Para margem m (0-1) com despesas fixas D: receita necessária = D / (1 − m)
  let aumentoReceitaNecessario: number | null = null;
  let reducaoDespesasNecessaria: number | null = null;
  if (g.margemDesejada != null && g.margemDesejada > 0 && g.margemDesejada < 100) {
    const m = g.margemDesejada / 100;
    const receitaNecessaria = p.despesas / (1 - m);
    aumentoReceitaNecessario = Math.max(0, r2(receitaNecessaria - p.receita));
    // Alternativa: manter receita e cortar despesas → D = R × (1 − m)
    const despesasNecessarias = p.receita * (1 - m);
    reducaoDespesasNecessaria = Math.max(0, r2(p.despesas - despesasNecessarias));
  }

  // O maior gap em R$ de receita vira referência para as conversões práticas.
  const receitaGapRef = Math.max(
    gapFaturamento ?? 0,
    aumentoReceitaNecessario ?? 0,
    gapLucro ?? 0
  );

  return {
    gapFaturamento,
    gapLucro,
    gapMargem,
    aumentoReceitaNecessario,
    reducaoDespesasNecessaria,
    novosMrrsNecessarios:
      receitaGapRef > 0 && b.avgTicketMrr > 0
        ? Math.ceil(receitaGapRef / b.avgTicketMrr)
        : receitaGapRef > 0
          ? null
          : 0,
    tcvsNecessarios:
      receitaGapRef > 0 && b.avgTicketTcv > 0
        ? Math.ceil(receitaGapRef / b.avgTicketTcv)
        : receitaGapRef > 0
          ? null
          : 0,
    upsellNecessario: receitaGapRef > 0 ? r2(Math.min(receitaGapRef, b.upsellPipeline)) : 0,
    inadimplenciaARecuperar:
      receitaGapRef > 0 ? r2(Math.min(receitaGapRef, b.inadimplenciaAberta)) : 0,
  };
}

/** Tom da sinalização visual (Design System B2C). */
export type Tone = "blue" | "green" | "yellow" | "red" | "gray";

export function marginTone(margem: number, desejada: number | null): Tone {
  const target = desejada ?? 30;
  if (margem >= target) return "green";
  if (margem >= target * 0.66) return "yellow";
  if (margem >= 0) return "red";
  return "red";
}

export function profitTone(lucro: number): Tone {
  if (lucro > 0) return "green";
  if (lucro === 0) return "gray";
  return "red";
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Resumo interpretativo do cenário (saída estratégica, PARTE 11.38).
 * Determinístico — construído só com os números calculados.
 */
export function buildNarrative(
  b: Baseline,
  atual: Projected,
  projetado: Projected,
  g: Goals,
  gaps: GapAnalysis
): string {
  const parts: string[] = [];
  const target = g.margemDesejada;

  if (target != null) {
    if (projetado.margem >= target) {
      parts.push(
        `No cenário simulado, a agência atinge a margem desejada de ${target}% (projeção: ${projetado.margem.toFixed(0)}%).`
      );
    } else {
      const caminhos: string[] = [];
      if (gaps.aumentoReceitaNecessario && gaps.aumentoReceitaNecessario > 0)
        caminhos.push(`aumentar ${brl(gaps.aumentoReceitaNecessario)} em receita`);
      if (gaps.reducaoDespesasNecessaria && gaps.reducaoDespesasNecessaria > 0)
        caminhos.push(`reduzir ${brl(gaps.reducaoDespesasNecessaria)} em despesas`);
      parts.push(
        `Para atingir a margem saudável de ${target}%, a agência precisa ${caminhos.join(" ou ")}, considerando o cenário ${projetado === atual ? "atual" : "simulado"}.`
      );

      // Caminho mais eficiente: recuperar inadimplência → upsell → cortar recorrentes.
      const eficiente: string[] = [];
      let restante = gaps.aumentoReceitaNecessario ?? 0;
      if (restante > 0 && b.inadimplenciaAberta > 0) {
        const rec = Math.min(restante, b.inadimplenciaAberta);
        eficiente.push(`recuperar ${brl(rec)} em inadimplência`);
        restante -= rec;
      }
      if (restante > 0 && b.upsellPipeline > 0) {
        const ups = Math.min(restante, b.upsellPipeline);
        eficiente.push(`vender ${brl(ups)} em upsell`);
        restante -= ups;
      }
      const corte = Math.min(
        gaps.reducaoDespesasNecessaria ?? 0,
        b.despesasRecorrentes * 0.3
      );
      if (corte > 0) eficiente.push(`reduzir ${brl(corte)} em despesas recorrentes`);
      if (eficiente.length > 0)
        parts.push(`O caminho mais eficiente seria ${eficiente.join(", ")}.`);
    }
  }

  if (g.metaFaturamento != null) {
    if ((gaps.gapFaturamento ?? 0) <= 0) {
      parts.push(`A meta de faturamento de ${brl(g.metaFaturamento)} é atingida no cenário.`);
    } else {
      const conv: string[] = [];
      if (gaps.novosMrrsNecessarios)
        conv.push(`~${gaps.novosMrrsNecessarios} novo(s) cliente(s) MRR (ticket ${brl(b.avgTicketMrr)})`);
      if (gaps.tcvsNecessarios)
        conv.push(`~${gaps.tcvsNecessarios} venda(s) TCV (ticket ${brl(b.avgTicketTcv)})`);
      parts.push(
        `Faltam ${brl(gaps.gapFaturamento!)} para a meta de faturamento${conv.length ? ` — equivalente a ${conv.join(" ou ")}` : ""}.`
      );
    }
  }

  if (g.metaLucro != null) {
    parts.push(
      (gaps.gapLucro ?? 0) <= 0
        ? `A meta de lucro de ${brl(g.metaLucro)} é atingida (projeção: ${brl(projetado.lucro)}).`
        : `Faltam ${brl(gaps.gapLucro!)} para a meta de lucro (projeção: ${brl(projetado.lucro)}).`
    );
  }

  if (parts.length === 0) {
    parts.push(
      projetado.lucro >= 0
        ? `Cenário projetado: receita ${brl(projetado.receita)}, despesas ${brl(projetado.despesas)}, lucro ${brl(projetado.lucro)} (margem ${projetado.margem.toFixed(0)}%). Defina metas para ver o plano de ação.`
        : `Cenário projetado com PREJUÍZO de ${brl(Math.abs(projetado.lucro))}. Priorize recuperar ${brl(Math.min(b.inadimplenciaAberta, Math.abs(projetado.lucro)))} em inadimplência e revisar despesas recorrentes (${brl(b.despesasRecorrentes)}/mês).`
    );
  }

  return parts.join(" ");
}
