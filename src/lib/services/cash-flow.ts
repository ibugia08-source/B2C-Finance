import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { BILLING_OPEN_STATUSES } from "@/lib/billing-status";
import { escopoAtual, whereDaCobranca } from "@/lib/services/data-scope";
import { toCompetence } from "@/lib/competence";

/**
 * FLUXO DE CAIXA PROJETADO, DIA A DIA (F3.11 · ref. 01 §7.2; 02 §4.4).
 *
 * A tela antiga respondia "como está a liquidez em 30, 60 e 90 dias" com três
 * números e uma tabela por conta. A pergunta que ela NÃO respondia é a que se
 * faz na segunda de manhã: **em que dia o dinheiro acaba, e por causa de
 * quê?** É para isso que a projeção agora é DIÁRIA, com o horizonte na mão de
 * quem lê e os lançamentos de cada dia à vista.
 *
 * É PREVISÃO DE CAIXA, não de competência: a data que manda é o VENCIMENTO,
 * nunca a competência. Projeção montada por competência mostra dinheiro que
 * ainda não entrou como se estivesse na conta, e é assim que se aprova uma
 * despesa contra um recebimento que só cai no mês seguinte.
 *
 * O QUE ENTRA, e por quê cada um:
 *
 *  ENTRADAS  cobrança em aberto com vencimento no período, pelo SALDO
 *            (valor − aplicações já feitas). Vencida que cai dentro da
 *            janela vem MARCADA: ela conta no caixa do dia em que venceu,
 *            mas quem lê precisa saber que aquele dinheiro já está atrasado
 *            — é a diferença entre "vai entrar" e "era para ter entrado".
 *
 *  SAÍDAS    despesa não paga com vencimento no período (as recorrências e
 *            as parcelas futuras JÁ MATERIALIZADAS entram por serem
 *            despesas como as outras) e fatura de cartão com vencimento no
 *            período, pelo saldo (total − pago).
 *
 *            A PARTIÇÃO CONTRA CONTAGEM DUPLA: compra no cartão é uma
 *            Transaction com `invoiceId`, e a fatura é o agregado dela.
 *            Contar as duas somaria o mesmo gasto duas vezes, então a
 *            despesa com fatura fica de fora e a fatura entra inteira.
 *            Compra de cartão AINDA sem fatura fechada entra sozinha —
 *            senão ela não apareceria em lugar nenhum.
 *
 *  FOLHA     folha APPROVED ainda não paga. Folha PAID já virou Transaction
 *            no ato do pagamento (actions/payroll), então contá-la aqui
 *            seria a mesma contagem dupla; e DRAFT fica fora porque
 *            rascunho não é compromisso (01: "Folha DRAFT fora do
 *            realizado").
 *
 *            A folha não tem campo de data prevista de pagamento — só
 *            `paidAt`, preenchido quando alguém paga. Então a data é uma
 *            CONVENÇÃO declarada (dia 5 do mês seguinte à competência) e a
 *            linha aparece marcada como estimada. Inventar em silêncio
 *            seria pior; omitir a maior saída do mês, muito pior ainda.
 *
 * O LIMITE, dito na tela: a projeção conta o que JÁ EXISTE. Mensalidade que
 * ainda não foi gerada e aluguel do mês que vem que ninguém lançou não
 * entram. Ela é sistematicamente otimista nas saídas e pessimista nas
 * entradas — e é melhor que quem lê saiba disso do que descubra sozinho.
 */

/** Horizontes de um clique. "Personalizado" é o intervalo livre. */
export const HORIZONTES = [7, 15, 30] as const;
export type Horizonte = (typeof HORIZONTES)[number];
export const HORIZONTE_PADRAO: Horizonte = 30;

/** Teto por fonte. Acima disto a tela DIZ que truncou (nunca mente calada). */
const TETO_POR_FONTE = 2000;

/** Convenção do pagamento da folha, na falta de data prevista no cadastro. */
export const DIA_DO_PAGAMENTO_DA_FOLHA = 5;

export const AVISO_DA_PROJECAO =
  "A projeção conta só o que já existe: cobrança emitida, despesa lançada, fatura fechada e folha aprovada. Mensalidade ainda não gerada e despesa recorrente que ninguém lançou não entram.";

export type TipoDeLancamento = "COBRANCA" | "DESPESA" | "FATURA" | "FOLHA";

export type LancamentoDoDia = {
  id: string;
  tipo: TipoDeLancamento;
  descricao: string;
  /** Positivo entra, negativo sai. */
  valor: number;
  /** Cobrança que já venceu (dentro da janela escolhida). */
  atrasada?: boolean;
  /** Data por convenção, não por cadastro (folha). */
  estimada?: boolean;
  href: string | null;
};

export type DiaDoFluxo = {
  /** YYYY-MM-DD (dia ancorado em UTC, como todas as datas do banco). */
  dia: string;
  entradas: number;
  saidas: number;
  /** Saldo consolidado ao fim deste dia. */
  saldoAcumulado: number;
  lancamentos: LancamentoDoDia[];
};

export type ContaNoFluxo = {
  accountId: string;
  nome: string;
  saldoAtual: number;
};

export type FluxoProjetado = {
  de: Date;
  ate: Date;
  /** Saldo consolidado das contas ativas no recorte escolhido. */
  saldoInicial: number;
  contas: ContaNoFluxo[];
  dias: DiaDoFluxo[];
  totalEntradas: number;
  totalSaidas: number;
  saldoFinal: number;
  /** Primeiro dia em que o saldo projetado cruza o zero, se cruzar. */
  primeiroDiaNegativo: { dia: string; saldo: number } | null;
  /** Alguma fonte bateu no teto de leitura — a tela avisa. */
  truncado: boolean;
  aviso: string;
};

export type OpcoesDoFluxo = {
  de: Date;
  ate: Date;
  /** Recorte por conta bancária: afeta o saldo inicial e as saídas endereçadas. */
  accountId?: string | null;
  /** Recorte por agência: afeta as cobranças (via relação cliente×agência). */
  agencyId?: string | null;
};

/** Dia canônico de um instante: as datas do banco são meia-noite UTC. */
function diaDe(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function diasEntre(de: Date, ate: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate()));
  const fim = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate()));
  // Teto duro de 400 dias: um intervalo digitado errado (ano trocado) não
  // pode virar uma tabela de dez mil linhas.
  for (let i = 0; cursor <= fim && i < 400; i++) {
    out.push(diaDe(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const centavo = (v: number) => Math.round(v * 100) / 100;

export async function fluxoProjetado(opcoes: OpcoesDoFluxo): Promise<FluxoProjetado> {
  const de = new Date(
    Date.UTC(opcoes.de.getUTCFullYear(), opcoes.de.getUTCMonth(), opcoes.de.getUTCDate())
  );
  const ate = new Date(
    Date.UTC(opcoes.ate.getUTCFullYear(), opcoes.ate.getUTCMonth(), opcoes.ate.getUTCDate(), 23, 59, 59, 999)
  );
  const hoje = diaDe(new Date());

  const escopo = await escopoAtual();
  // O recorte da URL só APERTA o recorte do usuário: quem enxerga uma agência
  // não vê outra escolhendo na querystring (S8).
  const escopoDaAgencia =
    escopo.kind === "AGENCY"
      ? { relationship: { agencyId: escopo.agencyId } }
      : opcoes.agencyId
        ? { relationship: { agencyId: opcoes.agencyId } }
        : {};

  const [contas, cobrancas, despesas, faturas, folhas] = await Promise.all([
    prisma.account.findMany({
      where: { active: true, ...(opcoes.accountId ? { id: opcoes.accountId } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, balance: true },
    }),
    prisma.billing.findMany({
      where: {
        ...whereDaCobranca(escopo),
        ...escopoDaAgencia,
        status: { in: [...BILLING_OPEN_STATUSES] },
        dueDate: { gte: de, lte: ate },
      },
      orderBy: { dueDate: "asc" },
      take: TETO_POR_FONTE,
      select: {
        id: true, description: true, amount: true, paidTotal: true, dueDate: true,
        client: { select: { id: true, name: true } },
      },
    }),
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { in: ["pendente", "devendo"] },
        // Despesa de fatura fica com a fatura (ver cabeçalho).
        invoiceId: null,
        ...(opcoes.accountId ? { accountId: opcoes.accountId } : {}),
        OR: [
          { dueDate: { gte: de, lte: ate } },
          { dueDate: null, date: { gte: de, lte: ate } },
        ],
      },
      orderBy: { dueDate: "asc" },
      take: TETO_POR_FONTE,
      select: {
        id: true, description: true, amount: true, dueDate: true, date: true,
        accountId: true,
      },
    }),
    prisma.creditCardInvoice.findMany({
      where: { status: { not: "paga" }, dueDate: { gte: de, lte: ate } },
      orderBy: { dueDate: "asc" },
      take: TETO_POR_FONTE,
      select: {
        id: true, dueDate: true, total: true, paid: true,
        card: { select: { name: true, accountId: true } },
      },
    }),
    prisma.payroll.findMany({
      where: { status: "APPROVED" },
      orderBy: [{ year: "asc" }, { month: "asc" }],
      take: 24,
      select: {
        id: true, month: true, year: true,
        items: { select: { amount: true } },
      },
    }),
  ]);

  const truncado =
    cobrancas.length === TETO_POR_FONTE ||
    despesas.length === TETO_POR_FONTE ||
    faturas.length === TETO_POR_FONTE;

  // Uma passada por fonte, tudo indexado por dia: nenhuma consulta dentro de
  // laço, nenhuma leitura por linha da tabela.
  const porDia = new Map<string, LancamentoDoDia[]>();
  const empurra = (dia: string, l: LancamentoDoDia) => {
    const lista = porDia.get(dia);
    if (lista) lista.push(l);
    else porDia.set(dia, [l]);
  };

  for (const b of cobrancas) {
    const saldo = centavo(n(b.amount) - n(b.paidTotal));
    if (saldo <= 0) continue;
    const dia = diaDe(b.dueDate);
    empurra(dia, {
      id: b.id,
      tipo: "COBRANCA",
      descricao: `${b.client?.name ?? "Cliente"} — ${b.description}`,
      valor: saldo,
      atrasada: dia < hoje,
      href: b.client ? `/clientes/${b.client.id}?tab=cobrancas` : "/cobrancas",
    });
  }

  for (const d of despesas) {
    const valor = centavo(n(d.amount));
    if (valor <= 0) continue;
    empurra(diaDe(d.dueDate ?? d.date), {
      id: d.id,
      tipo: "DESPESA",
      descricao: d.description ?? "Despesa",
      valor: -valor,
      href: "/despesas",
    });
  }

  for (const f of faturas) {
    // Conta com recorte escolhido: fatura de cartão de OUTRA conta sai.
    if (opcoes.accountId && f.card?.accountId !== opcoes.accountId) continue;
    const saldo = centavo(n(f.total) - n(f.paid));
    if (saldo <= 0) continue;
    empurra(diaDe(f.dueDate), {
      id: f.id,
      tipo: "FATURA",
      descricao: `Fatura ${f.card?.name ?? "do cartão"}`,
      valor: -saldo,
      href: "/cartoes",
    });
  }

  for (const p of folhas) {
    const total = centavo(p.items.reduce((s, i) => s + n(i.amount), 0));
    if (total <= 0) continue;
    // Dia 5 do mês seguinte à competência (convenção declarada).
    const pagamento = new Date(Date.UTC(p.year, p.month, DIA_DO_PAGAMENTO_DA_FOLHA));
    const dia = diaDe(pagamento);
    if (pagamento < de || pagamento > ate) continue;
    // Recorte por conta: a folha não escolhe conta no cadastro, então ela só
    // aparece no consolidado — filtrar por conta a esconderia sem dizer.
    if (opcoes.accountId) continue;
    empurra(dia, {
      id: p.id,
      tipo: "FOLHA",
      descricao: `Folha de ${toCompetence(p.year, p.month)} (aprovada)`,
      valor: -total,
      estimada: true,
      href: "/folha",
    });
  }

  const saldoInicial = centavo(contas.reduce((s, c) => s + n(c.balance), 0));

  let acumulado = saldoInicial;
  let totalEntradas = 0;
  let totalSaidas = 0;
  let primeiroDiaNegativo: { dia: string; saldo: number } | null = null;

  const dias: DiaDoFluxo[] = diasEntre(de, ate).map((dia) => {
    const lancamentos = (porDia.get(dia) ?? []).sort((a, b) => b.valor - a.valor);
    const entradas = centavo(
      lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0)
    );
    const saidas = centavo(
      lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0)
    );
    acumulado = centavo(acumulado + entradas - saidas);
    totalEntradas = centavo(totalEntradas + entradas);
    totalSaidas = centavo(totalSaidas + saidas);
    if (acumulado < 0 && !primeiroDiaNegativo)
      primeiroDiaNegativo = { dia, saldo: acumulado };
    return { dia, entradas, saidas, saldoAcumulado: acumulado, lancamentos };
  });

  return {
    de,
    ate,
    saldoInicial,
    contas: contas.map((c) => ({
      accountId: c.id, nome: c.name, saldoAtual: centavo(n(c.balance)),
    })),
    dias,
    totalEntradas,
    totalSaidas,
    saldoFinal: acumulado,
    primeiroDiaNegativo,
    truncado,
    aviso: AVISO_DA_PROJECAO,
  };
}
