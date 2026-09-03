/**
 * DRY-RUN DO CUTOVER FINANCEIRO (F0.11 — ref. 03 §3.2).
 *
 * Extrai do banco do v1 os SALDOS DE ABERTURA na data de corte e monta o
 * relatório de conferência. Não escreve nada: é leitura pura, feita para ser
 * comparada com extrato bancário, fatura e planilha antes de qualquer
 * lançamento de abertura.
 *
 * Os nove saldos que a especificação exige na abertura:
 *   contas bancárias · reservas · contas a receber abertas · créditos de
 *   clientes · contas a pagar · cartões · impostos e passivos · folha e
 *   comissões a pagar · empréstimos e parcelamentos.
 *
 * A DATA OFICIAL de cutover é a DECISÃO 19.32, em aberto. Enquanto não for
 * definida, rode com --data para simular candidatas. A recomendação da
 * especificação é o início de uma competência já fechada e conciliável.
 *
 * Uso:
 *   APP_ENV=local npx tsx scripts/cutover-dry-run.ts --data 2026-09-01
 *   ... --json  (para conferir contra planilha)
 */
import { loadEnv } from "../env";
import { assertNotProduction } from "../guard";
loadEnv();
assertNotProduction("scripts/cutover-dry-run.ts");

type Linha = {
  grupo: string;
  descricao: string;
  natureza: "ativo" | "passivo";
  valor: number;
  itens: number;
  observacao?: string;
};

const args = process.argv.slice(2);
const iData = args.indexOf("--data");
const dataArg = iData >= 0 ? args[iData + 1] : null;
const JSON_OUT = args.includes("--json");

if (!dataArg || !/^\d{4}-\d{2}-\d{2}$/.test(dataArg)) {
  console.error(
    "Informe a data candidata de corte: --data AAAA-MM-DD\n" +
      "(a data OFICIAL é a decisão 19.32, ainda em aberto)"
  );
  process.exit(1);
}
// Depois da guarda acima, a data existe. A constante estreitada evita que o
// TypeScript volte a ver `string | null` dentro das funções abaixo.
const DATA: string = dataArg;

// Meia-noite local do dia de corte: tudo ANTES disso é saldo de abertura.
const [ano, mes, dia] = DATA.split("-").map(Number);
const CORTE = new Date(ano, mes - 1, dia);

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { toNumber: n } = await import("@/lib/format");

  const linhas: Linha[] = [];

  await runWithoutScope(async () => {
    // ===== 1) Contas bancárias =====
    const contas = await prisma.account.findMany({
      select: { name: true, balance: true },
    });
    linhas.push({
      grupo: "1.1 Caixa e bancos",
      descricao: "Saldo das contas bancárias",
      natureza: "ativo",
      valor: contas.reduce((s, c) => s + n(c.balance), 0),
      itens: contas.length,
      observacao:
        contas.length === 0
          ? "Nenhuma conta cadastrada — o saldo terá de vir do extrato."
          : "Saldo do CADASTRO; conferir contra o extrato na data de corte.",
    });

    // ===== 2) Reservas =====
    const reservas = await prisma.cashBox.findMany({
      select: { name: true, currentAmount: true },
    });
    linhas.push({
      grupo: "1.2 Reservas",
      descricao: "Saldo das reservas de caixa",
      natureza: "ativo",
      valor: reservas.reduce((s, r) => s + n(r.currentAmount), 0),
      itens: reservas.length,
    });

    // ===== 3) Contas a receber abertas =====
    // Cobranças com competência ANTERIOR ao corte e saldo em aberto.
    const receber = await prisma.billing.findMany({
      where: {
        status: { notIn: ["PAID", "CANCELED"] },
        OR: [
          { competenceYear: { lt: ano } },
          { competenceYear: ano, competenceMonth: { lt: mes } },
        ],
      },
      select: { amount: true, paidTotal: true, dueDate: true },
    });
    const saldoReceber = receber.reduce(
      (s, b) => s + Math.max(0, n(b.amount) - n(b.paidTotal)),
      0
    );
    const vencidoNoCorte = receber
      .filter((b) => b.dueDate < CORTE)
      .reduce((s, b) => s + Math.max(0, n(b.amount) - n(b.paidTotal)), 0);
    linhas.push({
      grupo: "1.3 Contas a receber",
      descricao: "Cobranças abertas de competências anteriores ao corte",
      natureza: "ativo",
      valor: saldoReceber,
      itens: receber.length,
      observacao: `${brl(vencidoNoCorte)} já vencido na data de corte.`,
    });

    // ===== 4) Créditos de clientes =====
    // Pagamento além do saldo vira crédito (01 §3.12). O v1 recusa excedente,
    // então o saldo esperado é zero — a conferência existe para provar isso.
    const excedentes = await prisma.$queryRaw<{ n: number; total: number }[]>`
      SELECT COUNT(*)::int AS n, COALESCE(SUM("paidTotal" - "amount"), 0)::float AS total
        FROM "Billing" WHERE "paidTotal" > "amount"
    `;
    linhas.push({
      grupo: "1.4 Adiantamentos e créditos",
      descricao: "Crédito de cliente por pagamento a maior",
      natureza: "ativo",
      valor: Number(excedentes[0]?.total ?? 0),
      itens: Number(excedentes[0]?.n ?? 0),
      observacao:
        Number(excedentes[0]?.n ?? 0) === 0
          ? "Zero, como esperado: o v1 recusa pagamento acima do saldo."
          : "ATENÇÃO: há cobrança paga a maior — investigar antes do corte.",
    });

    // ===== 5) Contas a pagar =====
    const pagar = await prisma.transaction.findMany({
      where: { type: "despesa", status: { in: ["pendente", "devendo"] }, date: { lt: CORTE } },
      select: { amount: true, dueDate: true },
    });
    linhas.push({
      grupo: "2.1 Contas a pagar",
      descricao: "Despesas reconhecidas e não pagas até o corte",
      natureza: "passivo",
      valor: pagar.reduce((s, t) => s + n(t.amount), 0),
      itens: pagar.length,
    });

    // ===== 6) Cartões =====
    const faturas = await prisma.creditCardInvoice.findMany({
      where: { status: { not: "paga" } },
      select: { total: true, paid: true },
    });
    linhas.push({
      grupo: "2.2 Cartões a pagar",
      descricao: "Faturas de cartão em aberto",
      natureza: "passivo",
      valor: faturas.reduce((s, f) => s + Math.max(0, n(f.total) - n(f.paid)), 0),
      itens: faturas.length,
      observacao: "Conferir contra a fatura oficial do emissor.",
    });

    // ===== 7) Impostos e demais passivos =====
    const passivos = await prisma.liability.findMany({
      select: { name: true, remainingValue: true, type: true },
    });
    const impostos = passivos.filter((p) => String(p.type) === "TAX");
    const outros = passivos.filter((p) => String(p.type) !== "TAX" && String(p.type) !== "LOAN");
    linhas.push({
      grupo: "2.3 Impostos a pagar",
      descricao: "Passivos tributários registrados",
      natureza: "passivo",
      valor: impostos.reduce((s, p) => s + n(p.remainingValue), 0),
      itens: impostos.length,
      observacao:
        impostos.length === 0
          ? "Nenhum passivo tributário no v1 — levantar com a contabilidade."
          : undefined,
    });

    // ===== 8) Folha e comissões a pagar =====
    // Payroll não guarda total: soma os itens (dedução entra negativa).
    const folha = await prisma.payroll.findMany({
      where: { status: { in: ["DRAFT", "APPROVED"] } },
      select: { month: true, year: true, items: { select: { amount: true, kind: true } } },
    });
    const comissoes = await prisma.commission.findMany({
      where: { status: { not: "PAID" } },
      select: { amount: true },
    });
    linhas.push({
      grupo: "2.4 Folha e comissões a pagar",
      descricao: "Folhas não pagas e comissões pendentes",
      natureza: "passivo",
      valor:
        folha.reduce(
          (s, p) =>
            s +
            p.items.reduce(
              (t, i) => t + (i.kind === "DEDUCTION" ? -n(i.amount) : n(i.amount)),
              0
            ),
          0
        ) +
        comissoes.reduce((s, c) => s + n(c.amount), 0),
      itens: folha.length + comissoes.length,
      observacao: `${folha.length} folha(s) e ${comissoes.length} comissão(ões).`,
    });

    // ===== 9) Empréstimos e parcelamentos =====
    const emprestimos = await prisma.loan.findMany({
      select: { lender: true, remainingValue: true, principal: true },
    });
    const parcelamentos = passivos.filter((p) => String(p.type) === "LOAN");
    linhas.push({
      grupo: "2.5 Empréstimos e parcelamentos",
      descricao: "Saldo devedor de empréstimos e parcelamentos",
      natureza: "passivo",
      valor:
        // Sem saldo remanescente informado, o principal é o melhor palpite —
        // e a observação avisa que precisa de conferência externa.
        emprestimos.reduce((s, l) => s + (l.remainingValue != null ? n(l.remainingValue) : n(l.principal)), 0) +
        parcelamentos.reduce((s, p) => s + n(p.remainingValue), 0),
      itens: emprestimos.length + parcelamentos.length,
      observacao: outros.length > 0 ? `${outros.length} outro(s) passivo(s) fora deste grupo.` : undefined,
    });
  });

  if (JSON_OUT) {
    console.log(JSON.stringify({ dataCorte: DATA, linhas }, null, 2));
  } else {
    imprimir(DATA, linhas);
  }

  const { prisma: db } = await import("@/lib/prisma");
  await db.$disconnect();
}

function imprimir(data: string, linhas: Linha[]) {
  console.log(`\n╔═ SALDOS DE ABERTURA — corte em ${data} (candidato)`);
  console.log("║  Leitura pura do banco do v1. Nada foi gravado.\n");

  const ativos = linhas.filter((l) => l.natureza === "ativo");
  const passivos = linhas.filter((l) => l.natureza === "passivo");

  const bloco = (titulo: string, ls: Linha[]) => {
    console.log(`  ${titulo}`);
    for (const l of ls) {
      console.log(`   ${l.grupo.padEnd(32)} ${brl(l.valor).padStart(16)}  (${l.itens} item/itens)`);
      if (l.observacao) console.log(`      ${l.observacao}`);
    }
    const total = ls.reduce((s, l) => s + l.valor, 0);
    console.log(`   ${"TOTAL".padEnd(32)} ${brl(total).padStart(16)}\n`);
    return total;
  };

  const totalAtivo = bloco("ATIVOS", ativos);
  const totalPassivo = bloco("PASSIVOS", passivos);

  console.log(`  Situação líquida na abertura: ${brl(totalAtivo - totalPassivo)}`);
  console.log(`
  PENDÊNCIAS ANTES DO LANÇAMENTO DE ABERTURA (03 §3.2):
   · DECISÃO 19.32 — data OFICIAL de cutover ainda não definida.
   · Conferir cada linha contra a fonte externa (extrato, fatura, guia,
     contrato de empréstimo) e registrar quem conferiu.
   · Saldos que o v1 não guarda (impostos a recolher, empréstimos ativos)
     precisam ser levantados fora do sistema.
   · Só depois disso o lançamento de abertura é postado — auditado, e com o
     razão ligado (ledger_enabled).
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
