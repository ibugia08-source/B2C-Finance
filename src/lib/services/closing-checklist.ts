import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { ledgerHealth } from "@/lib/accounting/health";
import { toNumber as n } from "@/lib/format";
import type { Competence } from "@/lib/competence";

/**
 * CHECKLIST DE FECHAMENTO — os 16 itens de 01 §5.3 (F2.2).
 *
 * "Cada pendência com dono e link" é o pedido inteiro: uma lista que só diz
 * "faltam 12 coisas" transfere o problema de volta para quem abriu a tela.
 * Cada item aqui responde três perguntas — o que falta, de QUEM é, e ONDE se
 * resolve — e o link já leva com o mês certo na URL.
 *
 * A DECISÃO DE PROJETO MAIS IMPORTANTE DESTE ARQUIVO: um item que ainda não
 * pode ser medido aparece como NÃO MEDIDO, e não como verde. Sete dos
 * dezesseis dependem de coisas que só nascem nas fases 3 e 4 (conciliação,
 * rateio, provisão, fiscal, funil). Mostrar dezesseis verdes num sistema que
 * mede nove seria o pior resultado possível: o dono fecharia o mês confiando
 * numa conferência que não aconteceu.
 *
 * NENHUM ITEM BLOQUEIA O FECHAMENTO por decisão explícita: a spec lista os
 * dezesseis e NÃO diz quais impedem fechar. Inventar essa regra seria
 * inventar regra financeira. O que o sistema faz é registrar, no fechamento,
 * exatamente o que estava pendente — quem fechou, fechou sabendo.
 */

export type SituacaoItem = "OK" | "PENDENTE" | "NAO_MEDIDO" | "NAO_SE_APLICA";

export type ItemChecklist = {
  id: string;
  numero: number;
  titulo: string;
  /** O dono da pendência, no vocabulário da equipe. */
  dono: string;
  situacao: SituacaoItem;
  /** Quantos casos pendentes (0 quando OK). */
  quantidade: number;
  /** Uma frase: o que está pendente, ou por que não dá para medir. */
  detalhe: string;
  /** Onde se resolve, já com o mês na URL. */
  href: string | null;
};

const naoMedido = (
  numero: number,
  id: string,
  titulo: string,
  dono: string,
  porque: string
): ItemChecklist => ({
  id, numero, titulo, dono,
  situacao: "NAO_MEDIDO",
  quantidade: 0,
  detalhe: porque,
  href: null,
});

export async function montarChecklist(competence: Competence | string): Promise<ItemChecklist[]> {
  const [ano, mes] = competence.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, 1);
  const fim = new Date(ano, mes, 1);
  const q = `?mes=${competence}`;
  const workspaceId = await currentWorkspaceId();

  const [
    mrrSemCobranca,
    recebiveisIndefinidos,
    pagarEmAberto,
    despesas,
    despesasSemConta,
    folhaRascunho,
    ativos,
    avaliados,
    semGestor,
    saude,
  ] = await Promise.all([
    // 1. MRR ativo sem cobrança na competência.
    prisma.clientAgencyRelationship.count({
      where: {
        lifecycleStatus: "ACTIVE",
        currentCommercialTerm: { modality: "MRR", monthlyValue: { gt: 0 } },
        billings: { none: { competence } },
      },
    }),
    // 2. Recebíveis com situação definida: vencido, em aberto e ainda em
    //    NOT_CONTACTED é literalmente "ninguém sabe o que aconteceu com este".
    prisma.billing.count({
      where: {
        competence,
        status: { notIn: ["PAID", "CANCELED"] },
        dueDate: { lt: new Date() },
        collectionStatus: "NOT_CONTACTED",
      },
    }),
    // 3. Contas a pagar reconhecidas/definidas.
    prisma.transaction.count({
      where: { type: "despesa", date: { gte: inicio, lt: fim }, status: "pendente" },
    }),
    prisma.transaction.count({ where: { type: "despesa", date: { gte: inicio, lt: fim } } }),
    // 4. Sem conta gerencial.
    prisma.transaction.count({
      where: { type: "despesa", date: { gte: inicio, lt: fim }, categoryId: null },
    }),
    // 5. Folha fora de APPROVED/PAID.
    prisma.payroll.count({ where: { year: ano, month: mes, status: "DRAFT" } }),
    // 6 e 7. Carteira ativa.
    prisma.clientAgencyRelationship.count({ where: { lifecycleStatus: "ACTIVE" } }),
    prisma.avaliacaoMensal.count({ where: { competence, confirmedAt: { not: null } } }),
    prisma.clientAgencyRelationship.count({
      where: {
        lifecycleStatus: "ACTIVE",
        managers: { none: { validTo: null, role: "MANAGER_1" } },
      },
    }),
    ledgerHealth(workspaceId, { competence: competence as Competence }),
  ]);

  const MAX_SEM_CONTA = 5; // por cento
  const pctSemConta = despesas > 0 ? Math.round((despesasSemConta / despesas) * 100) : 0;
  const naoAvaliados = Math.max(0, ativos - avaliados);

  return [
    {
      id: "mrr-sem-cobranca", numero: 1,
      titulo: "Todo cliente de mensalidade tem cobrança no mês",
      dono: "Financeiro",
      situacao: mrrSemCobranca === 0 ? "OK" : "PENDENTE",
      quantidade: mrrSemCobranca,
      detalhe: mrrSemCobranca === 0
        ? "Nenhum cliente ativo de mensalidade ficou sem cobrança."
        : `${mrrSemCobranca} ${mrrSemCobranca === 1 ? "cliente ativo está" : "clientes ativos estão"} sem cobrança neste mês.`,
      href: `/cobrancas${q}`,
    },
    {
      id: "recebiveis", numero: 2,
      titulo: "Todo recebível vencido tem uma situação registrada",
      dono: "Cobrança",
      situacao: recebiveisIndefinidos === 0 ? "OK" : "PENDENTE",
      quantidade: recebiveisIndefinidos,
      detalhe: recebiveisIndefinidos === 0
        ? "Nenhuma cobrança vencida está sem tratativa."
        : `${recebiveisIndefinidos} ${recebiveisIndefinidos === 1 ? "cobrança vencida está" : "cobranças vencidas estão"} sem nenhum registro de contato.`,
      href: `/inadimplencia${q}`,
    },
    {
      id: "pagar", numero: 3,
      titulo: "Contas a pagar do mês definidas",
      dono: "Financeiro",
      situacao: pagarEmAberto === 0 ? "OK" : "PENDENTE",
      quantidade: pagarEmAberto,
      detalhe: pagarEmAberto === 0
        ? "Nenhuma despesa do mês ficou pendente."
        : `${pagarEmAberto} ${pagarEmAberto === 1 ? "despesa continua" : "despesas continuam"} em aberto.`,
      href: `/despesas${q}`,
    },
    {
      id: "conta-gerencial", numero: 4,
      titulo: `Despesas sem categoria abaixo de ${MAX_SEM_CONTA}%`,
      dono: "Financeiro",
      situacao: pctSemConta <= MAX_SEM_CONTA ? "OK" : "PENDENTE",
      quantidade: despesasSemConta,
      detalhe: despesas === 0
        ? "Nenhuma despesa lançada no mês."
        : `${pctSemConta}% das despesas do mês estão sem categoria (${despesasSemConta} de ${despesas}).`,
      href: `/despesas${q}`,
    },
    {
      id: "folha", numero: 5,
      titulo: "Folha aprovada ou paga",
      dono: "Administrador",
      situacao: folhaRascunho === 0 ? "OK" : "PENDENTE",
      quantidade: folhaRascunho,
      // Folha em rascunho fica FORA do realizado (decisão vigente §6.1 do 03):
      // fechar assim faz o resultado do mês parecer melhor do que foi.
      detalhe: folhaRascunho === 0
        ? "Nenhuma folha em rascunho."
        : "A folha ainda está em rascunho — e rascunho fica fora do resultado, então o mês fecharia melhor do que foi.",
      href: `/folha${q}`,
    },
    {
      id: "avaliacao", numero: 6,
      titulo: "Todos os clientes ativos avaliados",
      dono: "Gestor de contas",
      situacao: naoAvaliados === 0 ? "OK" : "PENDENTE",
      quantidade: naoAvaliados,
      detalhe: naoAvaliados === 0
        ? `Os ${ativos} clientes ativos foram avaliados.`
        : `${naoAvaliados} de ${ativos} clientes ativos ainda não foram avaliados.`,
      href: `/avaliacoes${q}`,
    },
    {
      id: "gestor-1", numero: 7,
      titulo: "Nenhum cliente ativo sem gestor responsável",
      dono: "Administrador",
      situacao: semGestor === 0 ? "OK" : "PENDENTE",
      quantidade: semGestor,
      detalhe: semGestor === 0
        ? "Todo cliente ativo tem gestor."
        : `${semGestor} ${semGestor === 1 ? "cliente ativo está" : "clientes ativos estão"} sem gestor responsável.`,
      href: "/clientes",
    },
    naoMedido(8, "conciliacao", "Conciliação bancária no mínimo por conta", "Financeiro",
      "A conciliação bancária chega na Fase 3 (F3.5). Até lá este item não é medido — e é dito, em vez de aparecer verde."),
    naoMedido(9, "rateios", "Rateios obrigatórios concluídos ou aceitos", "Financeiro",
      "O rateio de mídia por cliente chega na Fase 3 (F3.4)."),
    naoMedido(10, "provisao", "Provisão tributária confirmada", "Contador",
      "A provisão automática por entidade chega na Fase 3 (F3.3)."),
    naoMedido(11, "reserva-impostos", "Reserva de impostos revisada", "Administrador",
      "Depende da provisão (F3.3) e da regra de reserva restrita (decisão 19.34, respondida em 31/08: configurável por reserva)."),
    naoMedido(12, "fiscal", "Documentos fiscais emitidos ou justificados", "Financeiro",
      "Registro de nota chega na Fase 3 (F3.6) — e é OPCIONAL por decisão 19.38: a maioria dos serviços não emite nota."),
    naoMedido(13, "vendas-vinculadas", "Vendas ganhas vinculadas a cliente", "Comercial",
      "O funil comercial chega na Fase 4 (F4.1-F4.4)."),
    {
      id: "aprovacoes", numero: 14,
      titulo: "Aprovações decididas",
      dono: "—",
      situacao: "NAO_SE_APLICA",
      quantidade: 0,
      detalhe:
        "Não se aplica: a direção decidiu em 31/08 (19.35/19.36) que não existem tetos nem fila de aprovação. Ajuste é feito por quem tem a permissão e fica na trilha de auditoria.",
      href: null,
    },
    {
      id: "ledger", numero: 15,
      titulo: "Razão contábil balanceado",
      dono: "Administrador",
      situacao: !saude.enabled ? "NAO_MEDIDO" : saude.balanceOk ? "OK" : "PENDENTE",
      quantidade: saude.desbalanceadas.length,
      detalhe: !saude.enabled
        ? "O razão está desligado neste ambiente, então não há o que balancear."
        : saude.balanceOk
          ? `${saude.transacoes} lançamentos no mês, todos com débito igual a crédito.`
          : `${saude.desbalanceadas.length} lançamentos com débito diferente de crédito.`,
      href: null,
    },
    {
      id: "integridade", numero: 16,
      titulo: "Todo pagamento tem lançamento no razão",
      dono: "Administrador",
      situacao: !saude.enabled
        ? "NAO_MEDIDO"
        : saude.pagamentosSemLancamento === 0 ? "OK" : "PENDENTE",
      quantidade: saude.pagamentosSemLancamento,
      // A segunda pergunta do job de integridade: um razão balanceado e VAZIO
      // passa na primeira e não serve para nada.
      detalhe: !saude.enabled
        ? "O razão está desligado neste ambiente."
        : saude.pagamentosSemLancamento === 0
          ? `Cobertura de ${Math.round((saude.cobertura ?? 1) * 100)}% dos pagamentos.`
          : `${saude.pagamentosSemLancamento} pagamentos sem lançamento correspondente.`,
      href: null,
    },
  ];
}

export type ResumoChecklist = {
  itens: ItemChecklist[];
  ok: number;
  pendentes: number;
  naoMedidos: number;
  /** Total de casos a resolver somando todos os itens pendentes. */
  casos: number;
};

export async function resumoDoFechamento(
  competence: Competence | string
): Promise<ResumoChecklist> {
  const itens = await montarChecklist(competence);
  return {
    itens,
    ok: itens.filter((i) => i.situacao === "OK").length,
    pendentes: itens.filter((i) => i.situacao === "PENDENTE").length,
    naoMedidos: itens.filter((i) => i.situacao === "NAO_MEDIDO").length,
    casos: itens.reduce((s, i) => s + (i.situacao === "PENDENTE" ? i.quantidade : 0), 0),
  };
}

/** Texto curto do que ficou pendente — vai para a trilha no fechamento. */
export function pendenciasEmTexto(itens: ItemChecklist[]): string {
  const p = itens.filter((i) => i.situacao === "PENDENTE");
  if (p.length === 0) return "Checklist sem pendências.";
  return p.map((i) => `${i.titulo} (${i.quantidade})`).join("; ");
}

void n;
