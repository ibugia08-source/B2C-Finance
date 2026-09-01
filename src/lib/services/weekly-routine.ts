import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { competenceOf } from "@/lib/competence";
import { resumoDoRateio } from "@/lib/services/allocation";
import { resumoDaConciliacao } from "@/lib/services/reconciliation";
import { getLiquidez } from "@/lib/services/liquidity";
import { escopoAtual, clientesNoEscopo } from "@/lib/services/data-scope";

/**
 * ROTINA SEMANAL (F3.10 · ref. 02 §4.6).
 *
 * "Semanal (segunda): críticos/observação, renovações 30d sem negociação,
 * promessas da semana, pipeline parado 7+ dias, caixa projetado, rateios
 * pendentes, fiscais faltantes, comparativo da semana anterior; gera as
 * tarefas da semana."
 *
 * A DIFERENÇA ENTRE ESTA E A ROTINA DIÁRIA, que é a razão de as duas
 * existirem: a diária é sobre HOJE — quem cobrar, o que pagar, o que já
 * venceu. A semanal é sobre o que está ANDANDO NA DIREÇÃO ERRADA e ainda dá
 * tempo de corrigir: um cliente que vira crítico, uma renovação daqui a 25
 * dias que ninguém conversou, uma promessa que vence quinta. Nada disso é
 * urgente hoje, e é exatamente por isso que some da rotina diária todo dia
 * até virar problema.
 *
 * OS BLOCOS QUE NÃO DÁ PARA MEDIR APARECEM ASSIM, com o motivo — mesma regra
 * do checklist de fechamento. Um painel semanal com oito blocos verdes num
 * sistema que mede sete é pior que um painel com sete.
 */

export type SituacaoDoBloco = "OK" | "ATENCAO" | "NAO_MEDIDO";

export type ItemDaSemana = {
  /** Chave estável, para o item virar tarefa marcável. */
  chave: string;
  titulo: string;
  detalhe: string | null;
  valor: number | null;
  href: string | null;
};

export type BlocoDaSemana = {
  id: string;
  numero: number;
  titulo: string;
  dono: string;
  situacao: SituacaoDoBloco;
  /** Uma frase: o que este bloco está dizendo. */
  resumo: string;
  itens: ItemDaSemana[];
  href: string | null;
};

export type Comparativo = {
  recebidoSemana: number;
  recebidoSemanaAnterior: number;
  despesasSemana: number;
  despesasSemanaAnterior: number;
  novasCobrancas: number;
  novasCobrancasAnterior: number;
};

export type RotinaSemanal = {
  /** Segunda-feira da semana de referência. */
  inicio: Date;
  fim: Date;
  blocos: BlocoDaSemana[];
  comparativo: Comparativo;
  totalDeItens: number;
};

/** A segunda-feira da semana de uma data (domingo pertence à semana anterior). */
export function segundaDa(d: Date): Date {
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dia = base.getDay(); // 0=domingo
  const recuo = dia === 0 ? 6 : dia - 1;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() - recuo);
}

const naoMedido = (
  numero: number,
  id: string,
  titulo: string,
  dono: string,
  porque: string
): BlocoDaSemana => ({
  id, numero, titulo, dono,
  situacao: "NAO_MEDIDO",
  resumo: porque,
  itens: [],
  href: null,
});

export async function rotinaSemanal(hoje: Date = new Date()): Promise<RotinaSemanal> {
  const inicio = segundaDa(hoje);
  const fim = new Date(inicio.getTime() + 7 * 86_400_000);
  const inicioAnterior = new Date(inicio.getTime() - 7 * 86_400_000);
  const competence = competenceOf(hoje);
  const em30 = new Date(hoje.getTime() + 30 * 86_400_000);

  const scope = await escopoAtual();
  const idsDoEscopo = await clientesNoEscopo(scope);
  const filtroCliente = idsDoEscopo === null ? {} : { clientId: { in: idsDoEscopo } };

  const [
    avaliacoes,
    renovacoes,
    renovadosRecentemente,
    promessas,
    rateio,
    conciliacao,
    notasRascunho,
    liquidez,
    recebidoSemana,
    recebidoAnterior,
    despesasSemana,
    despesasAnterior,
    novasCobrancas,
    novasAnterior,
  ] = await Promise.all([
    // 1. Críticos e em observação — a avaliação da competência corrente.
    prisma.avaliacaoMensal.findMany({
      where: {
        competence,
        OR: [{ risco: { in: ["alto", "medio"] } }, { estabilidade: "caindo" }],
        ...(idsDoEscopo === null ? {} : { relationship: { clientId: { in: idsDoEscopo } } }),
      },
      select: {
        id: true, risco: true, estabilidade: true, observacao: true,
        relationship: { select: { clientId: true, client: { select: { name: true } } } },
      },
    }),
    // 2. Renovações nos próximos 30 dias.
    //
    // A fonte é o CONTRATO, não o `renewalMonth` do cliente: renewalMonth é
    // só um mês (1-12) e não distingue "renova dia 3" de "renova dia 28" —
    // e a diferença entre as duas é a semana inteira de conversa.
    prisma.contract.findMany({
      where: {
        renewalDate: { gte: hoje, lte: em30 },
        status: { in: ["ACTIVE", "RENEWAL"] },
        ...(idsDoEscopo === null ? {} : { clientId: { in: idsDoEscopo } }),
      },
      select: {
        id: true, clientId: true, renewalDate: true, totalValue: true,
        client: { select: { name: true } },
      },
    }),
    prisma.clientRenewal.findMany({
      where: { renewedAt: { gte: new Date(hoje.getTime() - 60 * 86_400_000) } },
      select: { clientId: true },
    }),
    // 3. Promessas com data nesta semana.
    prisma.collectionHistory.findMany({
      where: { status: "PROMISED", nextActionAt: { gte: inicio, lt: fim } },
      orderBy: { nextActionAt: "asc" },
      select: {
        id: true, nextActionAt: true, clientId: true,
        client: { select: { name: true } },
        billing: { select: { id: true, amount: true, paidTotal: true, status: true } },
      },
    }),
    resumoDoRateio(competence),
    resumoDaConciliacao(competence),
    prisma.fiscalDocument.count({ where: { status: "DRAFT" } }),
    getLiquidez(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).toISOString()),
    somaRecebida(inicio, fim),
    somaRecebida(inicioAnterior, inicio),
    somaDespesasPagas(inicio, fim),
    somaDespesasPagas(inicioAnterior, inicio),
    prisma.billing.count({ where: { ...filtroCliente, createdAt: { gte: inicio, lt: fim } } }),
    prisma.billing.count({
      where: { ...filtroCliente, createdAt: { gte: inicioAnterior, lt: inicio } },
    }),
  ]);

  const jaRenovados = new Set(renovadosRecentemente.map((r) => r.clientId));
  const semNegociacao = renovacoes.filter((c) => !jaRenovados.has(c.clientId));

  const promessasAbertas = promessas.filter(
    (p) => p.billing.status !== "PAID" && p.billing.status !== "CANCELED"
  );

  const blocos: BlocoDaSemana[] = [
    {
      id: "criticos", numero: 1,
      titulo: "Clientes críticos e em observação",
      dono: "Gestor",
      situacao: avaliacoes.length === 0 ? "OK" : "ATENCAO",
      resumo:
        avaliacoes.length === 0
          ? "Nenhum cliente marcado como risco ou em queda na avaliação do mês."
          : `${avaliacoes.length} ${avaliacoes.length === 1 ? "cliente pede" : "clientes pedem"} conversa esta semana.`,
      itens: avaliacoes.map((a) => ({
        chave: `critico:${a.id}`,
        titulo: a.relationship.client.name,
        detalhe:
          [a.risco ? `risco ${a.risco}` : null, a.estabilidade ? `estabilidade ${a.estabilidade}` : null]
            .filter(Boolean)
            .join(" · ") || null,
        valor: null,
        href: `/clientes/${a.relationship.clientId}`,
      })),
      href: "/avaliacoes",
    },
    {
      id: "renovacoes", numero: 2,
      titulo: "Renovações em 30 dias sem negociação",
      dono: "Gestor 1",
      situacao: semNegociacao.length === 0 ? "OK" : "ATENCAO",
      resumo:
        renovacoes.length === 0
          ? "Nenhuma renovação nos próximos 30 dias."
          : semNegociacao.length === 0
            ? `As ${renovacoes.length} renovações do período já têm negociação registrada.`
            : `${semNegociacao.length} de ${renovacoes.length} ainda não foram conversadas.`,
      itens: semNegociacao.map((c) => ({
        chave: `renovacao:${c.id}`,
        titulo: c.client.name,
        detalhe: c.renewalDate
          ? `renova em ${new Intl.DateTimeFormat("pt-BR").format(c.renewalDate)}`
          : null,
        valor: c.totalValue == null ? null : n(c.totalValue),
        href: `/renovacoes`,
      })),
      href: "/renovacoes",
    },
    {
      id: "promessas", numero: 3,
      titulo: "Promessas com data nesta semana",
      dono: "Cobrança",
      situacao: promessasAbertas.length === 0 ? "OK" : "ATENCAO",
      resumo:
        promessasAbertas.length === 0
          ? "Nenhuma promessa vence nesta semana."
          : `${promessasAbertas.length} ${promessasAbertas.length === 1 ? "promessa vence" : "promessas vencem"} nesta semana — confirmar ou recobrar.`,
      itens: promessasAbertas.map((p) => ({
        chave: `promessa:${p.id}`,
        titulo: p.client?.name ?? "(cliente)",
        detalhe: p.nextActionAt
          ? `prometeu para ${new Intl.DateTimeFormat("pt-BR").format(p.nextActionAt)}`
          : null,
        valor: Math.round((n(p.billing.amount) - n(p.billing.paidTotal)) * 100) / 100,
        href: "/fila",
      })),
      href: "/fila",
    },
    naoMedido(4, "pipeline", "Pipeline parado há 7 dias ou mais", "Comercial",
      "O funil comercial chega na Fase 4 (F4.1-F4.4). Até lá este bloco não é medido — e é dito, em vez de aparecer verde."),
    {
      id: "caixa", numero: 5,
      titulo: "Caixa projetado",
      dono: "Administrador",
      situacao: liquidez.projecao30d < 0 ? "ATENCAO" : "OK",
      resumo:
        liquidez.projecao30d < 0
          ? "A projeção de 30 dias fica NEGATIVA — decidir esta semana o que adiar ou antecipar."
          : "A projeção de 30 dias segue positiva.",
      itens: [
        { chave: "caixa:disponivel", titulo: "Disponível hoje", detalhe: "sem as reservas restritas", valor: liquidez.disponivel, href: "/caixa" },
        { chave: "caixa:entradas", titulo: "A receber em 30 dias", detalhe: null, valor: liquidez.entradas30d, href: "/cobrancas" },
        { chave: "caixa:saidas", titulo: "A pagar em 30 dias", detalhe: null, valor: -liquidez.saidas30d, href: "/despesas" },
        { chave: "caixa:projecao", titulo: "Projeção em 30 dias", detalhe: null, valor: liquidez.projecao30d, href: "/caixa" },
      ],
      href: "/caixa",
    },
    {
      id: "rateios", numero: 6,
      titulo: "Rateios pendentes",
      dono: "Financeiro",
      situacao: rateio.semNenhumRateio === 0 ? "OK" : "ATENCAO",
      resumo:
        rateio.despesas === 0
          ? "Nenhuma despesa de mídia no mês."
          : rateio.semNenhumRateio === 0
            ? `Mídia do mês tratada (${rateio.percentualConcluido ?? 0}% do valor com dono).`
            : `${rateio.semNenhumRateio} ${rateio.semNenhumRateio === 1 ? "lançamento de mídia espera" : "lançamentos de mídia esperam"} distribuição.`,
      itens: [],
      href: `/rateio?mes=${competence}`,
    },
    {
      id: "conciliacao", numero: 7,
      titulo: "Conciliação da semana",
      dono: "Financeiro",
      situacao: conciliacao.pendentes === 0 ? "OK" : "ATENCAO",
      resumo:
        conciliacao.pendentes === 0
          ? "Nenhuma conta fora do mínimo."
          : `${conciliacao.pendentes} ${conciliacao.pendentes === 1 ? "conta está" : "contas estão"} sem extrato ou abaixo do mínimo.`,
      itens: conciliacao.contas
        .filter((c) => c.situacao === "SEM_EXTRATO" || c.situacao === "ABAIXO_DO_MINIMO")
        .map((c) => ({
          chave: `conciliacao:${c.accountId}`,
          titulo: c.nome,
          detalhe:
            c.situacao === "SEM_EXTRATO"
              ? "extrato do mês não foi importado"
              : `${c.percentual}% conciliado`,
          valor: null,
          href: `/conciliacao?mes=${competence}&conta=${c.accountId}`,
        })),
      href: `/conciliacao?mes=${competence}`,
    },
    {
      id: "fiscais", numero: 8,
      titulo: "Notas fiscais paradas em rascunho",
      dono: "Financeiro",
      // DECIDIDO 19.38: emissão NÃO é obrigatória e não existe cadastro de
      // obrigatoriedade. O bloco cobra o que dá para cobrar sem inventar a
      // regra que a direção descartou: nota começada e não terminada.
      situacao: notasRascunho === 0 ? "OK" : "ATENCAO",
      resumo:
        notasRascunho === 0
          ? "Nenhuma nota em rascunho. Emissão não é obrigatória."
          : `${notasRascunho} ${notasRascunho === 1 ? "nota ficou" : "notas ficaram"} em rascunho.`,
      itens: [],
      href: "/relatorios",
    },
  ];

  return {
    inicio,
    fim,
    blocos,
    comparativo: {
      recebidoSemana, recebidoSemanaAnterior: recebidoAnterior,
      despesasSemana, despesasSemanaAnterior: despesasAnterior,
      novasCobrancas, novasCobrancasAnterior: novasAnterior,
    },
    totalDeItens: blocos.reduce((s, b) => s + b.itens.length, 0),
  };
}

async function somaRecebida(de: Date, ate: Date): Promise<number> {
  const r = await prisma.payment.aggregate({
    where: { status: "CONFIRMED", paidAt: { gte: de, lt: ate } },
    _sum: { amount: true },
  });
  return Math.round(n(r._sum.amount ?? 0) * 100) / 100;
}

async function somaDespesasPagas(de: Date, ate: Date): Promise<number> {
  const r = await prisma.transaction.aggregate({
    where: { type: "despesa", status: "pago", date: { gte: de, lt: ate } },
    _sum: { amount: true },
  });
  return Math.round(n(r._sum.amount ?? 0) * 100) / 100;
}
