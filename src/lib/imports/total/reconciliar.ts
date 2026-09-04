import type { PlanilhaTotal, LinhaMensal } from "./parser";
import type { Competence } from "@/lib/competence";

/**
 * RELATÓRIO DE RECONCILIAÇÃO POR MÊS (F1.13 v2).
 *
 * A prévia mostra, para cada competência da planilha, os números que a
 * pessoa vai conferir CONTRA a planilha dela antes de confirmar. É puro:
 * lê só o que foi parseado, sem tocar o banco — o que permite conferir a
 * planilha inteira antes de qualquer gravação.
 *
 * "Pago em MM/AAAA" aparece em DOIS lugares de propósito: soma no VENCIDO
 * do mês original (a fotografia daquele mês permanece vencida — 01 §5.6) e
 * na coluna RECUPERADO, para o total não parecer dinheiro perdido.
 */

export type LinhaReconciliacao = {
  competencia: Competence;
  ativos: number;          // clientes com cobrança no mês (exclui Sem cobrança/Removido)
  esperado: number;        // Σ valor_cobrado das cobranças do mês
  recebido: number;        // Σ pago DENTRO do mês (Pago, Pago com atraso, Parcial)
  recuperado: number;      // Σ "Pago em MM/AAAA" (entra no caixa de outro mês)
  vencido: number;         // Σ aberto vencido (Vencido, A vencer no passado, Pago em …)
  criticos: number;        // avaliações Crítico/risco Alto
  semValor: number;        // linhas sem valor_cobrado e sem valor conhecido do cliente
};

export function reconciliarPorMes(plan: PlanilhaTotal): LinhaReconciliacao[] {
  // Valor de referência por cliente (aba CLIENTES) para linha sem valor_cobrado.
  const valorDoCliente = new Map<string, number>();
  for (const c of plan.clientes) {
    const chaves = [c.documento, c.nome.toLowerCase().trim()].filter(Boolean) as string[];
    const valor = c.modalidade === "MRR" ? c.valorMensal ?? 0 : 0;
    for (const k of chaves) valorDoCliente.set(k, valor);
  }
  const valorDa = (l: LinhaMensal): number | null => {
    if (l.valorCobrado != null && l.valorCobrado > 0) return l.valorCobrado;
    const v = valorDoCliente.get(l.clienteRef) ?? valorDoCliente.get(l.clienteRef.toLowerCase().trim());
    return v && v > 0 ? v : null;
  };

  const porMes = new Map<Competence, LinhaReconciliacao>();
  const linhaDe = (comp: Competence): LinhaReconciliacao => {
    if (!porMes.has(comp))
      porMes.set(comp, {
        competencia: comp, ativos: 0, esperado: 0, recebido: 0,
        recuperado: 0, vencido: 0, criticos: 0, semValor: 0,
      });
    return porMes.get(comp)!;
  };

  for (const l of plan.mensal) {
    const r = linhaDe(l.competencia);
    if (l.estabilidade === "Crítico" || l.risco === "Alto") r.criticos++;

    const t = l.status.tipo;
    if (t === "SEM_COBRANCA" || t === "REMOVIDO") continue;

    r.ativos++;
    const valor = valorDa(l);
    if (valor == null) { r.semValor++; continue; }

    r.esperado += valor;
    if (t === "PAGO" || t === "PAGO_COM_ATRASO") r.recebido += valor;
    else if (t === "PARCIAL") { r.recebido += l.valorPago ?? 0; r.vencido += valor - (l.valorPago ?? 0); }
    else if (t === "PAGO_EM") { r.recuperado += valor; r.vencido += valor; }
    else r.vencido += valor; // VENCIDO e A_VENCER históricos
  }

  const arred = (x: number) => Math.round(x * 100) / 100;
  return [...porMes.values()]
    .sort((a, b) => (a.competencia < b.competencia ? -1 : 1))
    .map((r) => ({
      ...r,
      esperado: arred(r.esperado), recebido: arred(r.recebido),
      recuperado: arred(r.recuperado), vencido: arred(r.vencido),
    }));
}
