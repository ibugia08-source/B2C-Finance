import { prisma } from "@/lib/prisma";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { ledgerHealth } from "@/lib/accounting/health";
import { toNumber as n } from "@/lib/format";
import { resumoDoRateio } from "@/lib/services/allocation";
import { sugerirProvisoes } from "@/lib/services/tax-provision";
import { MINIMO_CONCILIADO, resumoDaConciliacao } from "@/lib/services/reconciliation";
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
 * pode ser medido aparece como NÃO MEDIDO, e não como verde. Mostrar dezesseis
 * verdes num sistema que mede nove seria o pior resultado possível: o dono
 * fecharia o mês confiando numa conferência que não aconteceu.
 *
 * A lista de não medidos ENCOLHE conforme as fases entregam: na F3.4 saíram
 * quatro (rateio, provisão, reserva e fiscal), na F3.5 a conciliação bancária
 * e na F4.4 as vendas vinculadas. **Os dezesseis itens são medidos.** Se um
 * dia voltar a aparecer NÃO MEDIDO aqui, é porque nasceu item novo — e ele
 * tem de dizer por quê, como estes disseram.
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

/**
 * Item que ainda não pode ser medido. SEM USO desde a F4.4 — os dezesseis
 * itens passaram a ser medidos.
 *
 * Fica aqui de propósito, e não é código morto: é o formato obrigatório do
 * item novo que ainda não tem como medir. Apagar o helper convidaria a
 * próxima pessoa a fazer o que ele evita — marcar de verde o que não mede.
 */
export const naoMedido = (
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
    rateio,
    provisoes,
    conciliacao,
    vendasSoltas,
    notasEmRascunho,
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
    // 9. Rateio de mídia (F3.4).
    resumoDoRateio(competence as Competence),
    // 10 e 11. Provisão e reserva por entidade (F3.3).
    sugerirProvisoes(competence),
    // 8. Conciliação bancária (F3.5).
    resumoDaConciliacao(competence as Competence),
    // 13. Vendas ganhas que não foram entregues à operação (F4.4).
    prisma.opportunity.count({ where: { stage: "GANHA", createdClientId: null } }),
    // 12. Notas paradas em rascunho (F3.6).
    prisma.fiscalDocument.count({
      where: { issuedAt: { gte: inicio, lt: fim }, status: "DRAFT" },
    }),
  ]);

  const MAX_SEM_CONTA = 5; // por cento
  const pctSemConta = despesas > 0 ? Math.round((despesasSemConta / despesas) * 100) : 0;
  const naoAvaliados = Math.max(0, ativos - avaliados);
  const comAliquota = provisoes.filter((p) => !p.semAliquota);
  const provisoesMedidas = comAliquota.length;
  const provisoesPendentes = comAliquota.filter((p) => !p.jaLancada).length;
  const reservasPendentes = comAliquota.filter((p) => p.jaLancada && !p.reservaFeita).length;

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
    {
      id: "conciliacao", numero: 8,
      titulo: "Conciliação bancária no mínimo por conta",
      dono: "Financeiro",
      // DECIDIDO 19.37: conta COM movimento se concilia até o dia 5; conta
      // PARADA só tem o saldo confirmado. Por isso conta sem movimento nem
      // extrato não entra na conta de pendências — cobrar conciliação de uma
      // conta que não movimentou é a linha vermelha que ensina a ignorar a
      // lista inteira.
      situacao: conciliacao.pendentes === 0 ? "OK" : "PENDENTE",
      quantidade: conciliacao.pendentes,
      detalhe:
        conciliacao.contas.length === 0
          ? "Nenhuma conta cadastrada."
          : conciliacao.pendentes === 0
            ? conciliacao.percentualGeral === null
              ? "Nenhuma conta teve movimento no mês."
              : `${conciliacao.percentualGeral}% das linhas de extrato do mês estão resolvidas.`
            : `${conciliacao.pendentes} ${conciliacao.pendentes === 1 ? "conta está" : "contas estão"} sem extrato ou abaixo de ${MINIMO_CONCILIADO}% conciliado.`,
      href: `/conciliacao${q}`,
    },
    {
      id: "rateios", numero: 9,
      titulo: "Rateios obrigatórios concluídos ou aceitos",
      dono: "Financeiro",
      // "Ou aceitos como não alocados" (01 §5.3) é o que faz este item ser
      // fechável: mídia sem cliente é normal — campanha da própria agência,
      // teste, prospecção. O que o item cobra é ter OLHADO. Por isso a conta
      // é a de lançamentos SEM NENHUMA LINHA de rateio, e não a de valor sem
      // dono: exigir 100% alocado obrigaria a inventar um cliente para o
      // gasto que não é de cliente nenhum.
      situacao: rateio.semNenhumRateio === 0 ? "OK" : "PENDENTE",
      quantidade: rateio.semNenhumRateio,
      detalhe:
        rateio.despesas === 0
          ? "Nenhuma despesa de mídia neste mês."
          : rateio.semNenhumRateio === 0
            ? `Toda a mídia do mês foi tratada (${rateio.percentualConcluido ?? 0}% do valor com dono).`
            : `${rateio.semNenhumRateio} ${rateio.semNenhumRateio === 1 ? "lançamento de mídia não foi" : "lançamentos de mídia não foram"} distribuído nem aceito sem dono.`,
      href: `/rateio${q}`,
    },
    {
      id: "provisao", numero: 10,
      titulo: "Provisão tributária confirmada",
      dono: "Contador",
      // Entidade SEM alíquota configurada não conta como pendência: não há
      // o que provisionar enquanto ninguém disser qual é a alíquota, e
      // marcá-la em vermelho todo mês ensinaria a ignorar a lista.
      situacao: provisoesPendentes === 0 ? "OK" : "PENDENTE",
      quantidade: provisoesPendentes,
      detalhe:
        provisoesMedidas === 0
          ? "Nenhuma entidade com alíquota efetiva configurada."
          : provisoesPendentes === 0
            ? "Todas as entidades com alíquota configurada estão provisionadas."
            : `${provisoesPendentes} de ${provisoesMedidas} ${provisoesMedidas === 1 ? "entidade não foi provisionada" : "entidades não foram provisionadas"}.`,
      href: `/impostos${q}`,
    },
    {
      id: "reserva-impostos", numero: 11,
      titulo: "Reserva de impostos revisada",
      dono: "Administrador",
      // O sistema NUNCA transfere (01 §3.8): aqui ele pergunta se alguém
      // transferiu. "Revisada" é o gesto humano, e é isso que se registra.
      situacao: reservasPendentes === 0 ? "OK" : "PENDENTE",
      quantidade: reservasPendentes,
      detalhe:
        provisoesMedidas === 0
          ? "Sem provisão no mês, não há reserva a revisar."
          : reservasPendentes === 0
            ? "Reserva conferida em todas as entidades provisionadas."
            : `${reservasPendentes} ${reservasPendentes === 1 ? "reserva ainda não foi" : "reservas ainda não foram"} confirmada.`,
      href: `/impostos${q}`,
    },
    {
      id: "fiscal", numero: 12,
      titulo: "Documentos fiscais emitidos ou justificados",
      dono: "Financeiro",
      // DECIDIDO 19.38: nota é OPCIONAL — a maioria dos serviços não emite,
      // e não existe cadastro de "obrigatoriedade" no sistema. Então o item
      // NÃO cobra emissão: ele cobra que nenhuma nota fique em rascunho, que
      // é a única pendência fiscal que o sistema consegue enxergar sem
      // inventar uma regra que a direção descartou.
      situacao: notasEmRascunho === 0 ? "OK" : "PENDENTE",
      quantidade: notasEmRascunho,
      detalhe:
        notasEmRascunho === 0
          ? "Nenhuma nota em rascunho. Emissão não é obrigatória (decisão da direção)."
          : `${notasEmRascunho} ${notasEmRascunho === 1 ? "nota ficou" : "notas ficaram"} em rascunho, sem emitir nem descartar.`,
      href: `/relatorios`,
    },
    {
      id: "vendas-vinculadas", numero: 13,
      titulo: "Vendas ganhas vinculadas a cliente",
      dono: "Comercial",
      // Uma venda pode ser marcada GANHA arrastando o card no quadro, sem
      // passar pelo fluxo que entrega para a operação. A venda fica
      // registrada e a operação não sabe dela — é exatamente isso que este
      // item procura, e por isso ele mede o que NÃO gerou cliente.
      situacao: vendasSoltas === 0 ? "OK" : "PENDENTE",
      quantidade: vendasSoltas,
      detalhe:
        vendasSoltas === 0
          ? "Toda venda ganha virou cliente na operação."
          : `${vendasSoltas} ${vendasSoltas === 1 ? "venda ganha não virou" : "vendas ganhas não viraram"} cliente, contrato nem cobrança.`,
      href: "/funil",
    },
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
