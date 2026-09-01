import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import { dataBr, hashDaLinha, lerCsv, lerExtrato, lerOfx, valorBr } from "@/lib/reconciliation/parse";
import {
  conciliar, ignorarLinha, importarExtrato, linhasDaConta, reabrirLinha,
  recalcularEstado, resumoDaConciliacao, sugerirMatches, MINIMO_CONCILIADO,
} from "@/lib/services/reconciliation";
import { montarChecklist } from "@/lib/services/closing-checklist";

/**
 * F3.5 — conciliação bancária.
 *
 * A regra que estes testes protegem é a de 02 §4.4 em três palavras: NADA
 * SILENCIOSO. A conciliação liga o que o banco diz ao que o sistema sabe e
 * NUNCA cria receita nem despesa por conta própria. Conciliação que "resolve
 * sozinha" a diferença é como entra no sistema uma receita que ninguém vendeu
 * — pelo caminho que mais parece certo, porque o extrato bate.
 */

const OFX = `
OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<DTSTART>20270301
<DTEND>20270331
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20270310120000[-3:BRT]<TRNAMT>1000.00<FITID>A1<MEMO>PIX RECEBIDO CLIENTE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20270312<TRNAMT>-250.50<FITID>A2<MEMO>PAGAMENTO FORNECEDOR</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>SEMDATA<TRNAMT>-10.00<FITID>A3<MEMO>QUEBRADA</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>4321.00<DTASOF>20270331</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
`;

const CSV = `Data;Histórico;Valor;Saldo
10/03/2027;PIX RECEBIDO CLIENTE;1.000,00;4.000,00
12/03/2027;PAGAMENTO FORNECEDOR;-250,50;3.749,50
15/03/2027;;abacaxi;3.749,50
`;

describe("F3.5 — leitura de extrato, sem banco", () => {
  it("lê OFX e ignora a linha ilegível DIZENDO qual é", () => {
    const r = lerOfx(OFX);
    expect(r.formato).toBe("OFX");
    expect(r.linhas).toHaveLength(2);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0].erro).toMatch(/data/i);
    expect(r.linhas[0].amount).toBe(1000);
    expect(r.linhas[1].amount).toBe(-250.5);
    expect(r.linhas[0].externalId).toBe("A1");
    expect(r.closingBalance).toBe(4321);
  });

  it("lê CSV com ponto e vírgula, vírgula decimal e saldo", () => {
    const r = lerCsv(CSV);
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas[0].amount).toBe(1000);
    expect(r.linhas[1].amount).toBe(-250.5);
    expect(r.linhas[1].balanceAfter).toBe(3749.5);
    expect(r.erros[0].erro).toMatch(/abacaxi/);
  });

  it("linha ilegível NUNCA vira movimento de R$ 0,00", () => {
    const r = lerCsv(CSV);
    expect(r.linhas.some((l) => l.amount === 0)).toBe(false);
  });

  it("escolhe o leitor pelo conteúdo, não pela extensão", () => {
    expect(lerExtrato(OFX).formato).toBe("OFX");
    expect(lerExtrato(CSV).formato).toBe("CSV");
  });

  it("entende os dois jeitos de escrever mil e duzentos e trinta e quatro", () => {
    expect(valorBr("1.234,56")).toBe(1234.56);
    expect(valorBr("1,234.56")).toBe(1234.56);
    expect(valorBr("R$ -250,50")).toBe(-250.5);
    expect(valorBr("980")).toBe(980);
  });

  it("entende as três formas de data de extrato brasileiro", () => {
    expect(dataBr("15/03/2027")?.getMonth()).toBe(2);
    expect(dataBr("2027-03-15")?.getDate()).toBe(15);
    expect(dataBr("15-03-2027")?.getFullYear()).toBe(2027);
    expect(dataBr("ontem")).toBeNull();
  });

  it("o hash usa o FITID quando existe e o conjunto quando não existe", () => {
    const base = { postedAt: new Date(2027, 2, 10), amount: 100, description: "PIX" };
    // Mesmo FITID em contas diferentes NÃO colide.
    expect(hashDaLinha("c1", { ...base, externalId: "X" })).not.toBe(
      hashDaLinha("c2", { ...base, externalId: "X" })
    );
    // Sem FITID, descrição com espaçamento diferente é a MESMA linha.
    expect(hashDaLinha("c1", { ...base, description: "PIX  RECEBIDO" })).toBe(
      hashDaLinha("c1", { ...base, description: "pix recebido" })
    );
  });
});

describe("F3.5 — importação, match e estado", () => {
  let dono: TestOwner;
  let contaId: string;

  beforeAll(async () => {
    dono = await createOwner();
    contaId = await asOwner(dono, async () =>
      (
        await prisma.account.create({
          data: { name: "Conta corrente do teste", type: "corrente", balance: 4000 },
          select: { id: true },
        })
      ).id
    );
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.reconciliationMatch.deleteMany({});
      await prisma.bankStatementEntry.deleteMany({});
      await prisma.bankStatement.deleteMany({});
    });
  });

  afterAll(async () => {
    await asOwner(dono, async () => {
      await prisma.reconciliationMatch.deleteMany({});
      await prisma.bankStatementEntry.deleteMany({});
      await prisma.bankStatement.deleteMany({});
      await prisma.transaction.deleteMany({});
      await prisma.account.deleteMany({ where: { id: contaId } });
    });
    await destroyOwner(dono);
  });

  it("importa e NÃO duplica quando o mesmo extrato é reimportado", async () => {
    await asOwner(dono, async () => {
      const um = await importarExtrato(contaId, "marco.ofx", OFX);
      expect(um.ok).toBe(true);
      if (um.ok) {
        expect(um.importadas).toBe(2);
        expect(um.erros).toHaveLength(1);
      }

      const dois = await importarExtrato(contaId, "marco-de-novo.ofx", OFX);
      expect(dois.ok).toBe(true);
      if (dois.ok) {
        expect(dois.importadas).toBe(0);
        expect(dois.duplicadas).toBe(2);
      }

      const total = await prisma.bankStatementEntry.count({ where: { accountId: contaId } });
      expect(total).toBe(2);
    });
  });

  it("OFX e CSV do mesmo mês convivem sem duplicar (o FITID manda)", async () => {
    await asOwner(dono, async () => {
      await importarExtrato(contaId, "marco.ofx", OFX);
      const csv = await importarExtrato(contaId, "marco.csv", CSV);
      // O CSV não tem FITID, então o hash é outro: as linhas ENTRAM. É o
      // limite honesto da deduplicação — sem identificador do banco, não há
      // informação que ligue as duas versões do mesmo movimento.
      expect(csv.ok).toBe(true);
      if (csv.ok) expect(csv.importadas).toBe(2);
    });
  });

  it("sugere o pagamento com o mesmo valor no mesmo dia", async () => {
    await asOwner(dono, async () => {
      await importarExtrato(contaId, "marco.ofx", OFX);
      const c = await createMrrClient(dono, { name: "Cliente sugestão" });
      const b = await createBilling(dono, c.id, { month: 3, year: 2027, amount: 1000 });
      await prisma.payment.create({
        data: {
          billingId: b.id, amount: 1000, paidAt: new Date(2027, 2, 10),
          method: "PIX", status: "CONFIRMED", accountId: contaId,
        },
      });

      const entrada = await prisma.bankStatementEntry.findFirstOrThrow({
        where: { accountId: contaId, amount: 1000 },
      });
      const s = await sugerirMatches(entrada.id);
      expect(s.length).toBeGreaterThan(0);
      expect(s[0].targetType).toBe("PAYMENT");
      expect(s[0].confidence).toBe(98);
      expect(s[0].motivo).toMatch(/mesmo dia/);
    });
  });

  it("S18: venda 1.000 + taxa 30 conciliam a linha de 970 SEM inventar diferença", async () => {
    await asOwner(dono, async () => {
      const statement = await prisma.bankStatement.create({
        data: {
          accountId: contaId, fileName: "liquido.csv", format: "CSV",
          periodStart: new Date(2027, 2, 1), periodEnd: new Date(2027, 2, 31),
        },
        select: { id: true },
      });
      const entrada = await prisma.bankStatementEntry.create({
        data: {
          statementId: statement.id, accountId: contaId, hash: "s18",
          postedAt: new Date(2027, 2, 20), amount: 970,
          description: "LIQUIDACAO CARTAO",
        },
        select: { id: true },
      });

      const c = await createMrrClient(dono, { name: "Cliente S18" });
      const b = await createBilling(dono, c.id, { month: 3, year: 2027, amount: 1000 });
      const pagamento = await prisma.payment.create({
        data: {
          billingId: b.id, amount: 1000, paidAt: new Date(2027, 2, 20),
          method: "PIX", status: "CONFIRMED", accountId: contaId,
        },
        select: { id: true },
      });
      const taxa = await prisma.transaction.create({
        data: {
          date: new Date(2027, 2, 20), description: "Taxa da maquininha", amount: 30,
          type: "despesa", status: "pago", belongsTo: "empresa", accountId: contaId,
        },
        select: { id: true },
      });

      const r = await conciliar({
        entryId: entrada.id,
        alvos: [
          { targetType: "PAYMENT", targetId: pagamento.id, amount: 1000 },
          { targetType: "TRANSACTION", targetId: taxa.id, amount: -30 },
        ],
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.state).toBe("MATCHED");
        expect(r.diferenca).toBe(0);
      }
    });
  });

  it("soma que não fecha vira PARCIAL, e nada é lançado por isso", async () => {
    await asOwner(dono, async () => {
      await importarExtrato(contaId, "marco.ofx", OFX);
      const entrada = await prisma.bankStatementEntry.findFirstOrThrow({
        where: { accountId: contaId, amount: 1000 },
      });
      const c = await createMrrClient(dono, { name: "Cliente parcial" });
      const b = await createBilling(dono, c.id, { month: 3, year: 2027, amount: 900 });
      const p = await prisma.payment.create({
        data: {
          billingId: b.id, amount: 900, paidAt: new Date(2027, 2, 10),
          method: "PIX", status: "CONFIRMED", accountId: contaId,
        },
        select: { id: true },
      });

      const antes = await prisma.transaction.count({});
      const r = await conciliar({
        entryId: entrada.id,
        alvos: [{ targetType: "PAYMENT", targetId: p.id, amount: 900 }],
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.state).toBe("PARTIAL");
        expect(r.diferenca).toBe(100);
      }
      // NADA SILENCIOSO: a diferença de 100 não virou despesa nem receita.
      expect(await prisma.transaction.count({})).toBe(antes);
    });
  });

  it("aceitar a diferença manda para REVISÃO com o motivo escrito", async () => {
    await asOwner(dono, async () => {
      await importarExtrato(contaId, "marco.ofx", OFX);
      const entrada = await prisma.bankStatementEntry.findFirstOrThrow({
        where: { accountId: contaId, amount: 1000 },
      });
      const c = await createMrrClient(dono, { name: "Cliente revisão" });
      const b = await createBilling(dono, c.id, { month: 3, year: 2027, amount: 900 });
      const p = await prisma.payment.create({
        data: {
          billingId: b.id, amount: 900, paidAt: new Date(2027, 2, 10),
          method: "PIX", status: "CONFIRMED", accountId: contaId,
        },
        select: { id: true },
      });

      const r = await conciliar({
        entryId: entrada.id,
        alvos: [{ targetType: "PAYMENT", targetId: p.id, amount: 900 }],
        aceitarDiferenca: "Cliente pagou juros de atraso junto",
      });
      expect(r.ok).toBe(true);
      const depois = await prisma.bankStatementEntry.findUniqueOrThrow({ where: { id: entrada.id } });
      expect(depois.state).toBe("REVIEW");
      expect(depois.note).toMatch(/juros de atraso/);
      expect(depois.note).toMatch(/100\.00/);
    });
  });

  it("conciliar de novo SUBSTITUI: não concilia o dobro do que o banco moveu", async () => {
    await asOwner(dono, async () => {
      await importarExtrato(contaId, "marco.ofx", OFX);
      const entrada = await prisma.bankStatementEntry.findFirstOrThrow({
        where: { accountId: contaId, amount: 1000 },
      });
      const c = await createMrrClient(dono, { name: "Cliente substituição" });
      const b = await createBilling(dono, c.id, { month: 3, year: 2027, amount: 1000 });
      const p = await prisma.payment.create({
        data: {
          billingId: b.id, amount: 1000, paidAt: new Date(2027, 2, 10),
          method: "PIX", status: "CONFIRMED", accountId: contaId,
        },
        select: { id: true },
      });

      await conciliar({ entryId: entrada.id, alvos: [{ targetType: "PAYMENT", targetId: p.id, amount: 1000 }] });
      await conciliar({ entryId: entrada.id, alvos: [{ targetType: "PAYMENT", targetId: p.id, amount: 1000 }] });

      const matches = await prisma.reconciliationMatch.count({ where: { entryId: entrada.id } });
      expect(matches).toBe(1);
    });
  });

  it("o mesmo lançamento duas vezes na mesma linha é recusado", async () => {
    await asOwner(dono, async () => {
      await importarExtrato(contaId, "marco.ofx", OFX);
      const entrada = await prisma.bankStatementEntry.findFirstOrThrow({
        where: { accountId: contaId, amount: 1000 },
      });
      const r = await conciliar({
        entryId: entrada.id,
        alvos: [
          { targetType: "PAYMENT", targetId: "x", amount: 500 },
          { targetType: "PAYMENT", targetId: "x", amount: 500 },
        ],
      });
      expect(r.ok).toBe(false);
    });
  });

  it("ignorar EXIGE motivo, e o motivo fica na linha", async () => {
    await asOwner(dono, async () => {
      await importarExtrato(contaId, "marco.ofx", OFX);
      const entrada = await prisma.bankStatementEntry.findFirstOrThrow({
        where: { accountId: contaId, amount: -250.5 },
      });

      expect((await ignorarLinha(entrada.id, "x")).ok).toBe(false);

      const r = await ignorarLinha(entrada.id, "Transferência entre contas próprias");
      expect(r.ok).toBe(true);
      const depois = await prisma.bankStatementEntry.findUniqueOrThrow({ where: { id: entrada.id } });
      expect(depois.state).toBe("IGNORED");
      expect(depois.note).toMatch(/contas próprias/);

      // Ignorada continua ignorada quando o estado é recalculado — o recálculo
      // deriva dos matches e não pode desfazer uma decisão humana.
      const rec = await recalcularEstado(entrada.id);
      expect(rec.state).toBe("IGNORED");

      await reabrirLinha(entrada.id);
      const voltou = await prisma.bankStatementEntry.findUniqueOrThrow({ where: { id: entrada.id } });
      expect(voltou.state).toBe("UNMATCHED");
      expect(voltou.note).toBeNull();
    });
  });

  it("o resumo separa conta parada de conta sem extrato (19.37)", async () => {
    await asOwner(dono, async () => {
      const parada = await prisma.account.create({
        data: { name: "Conta parada do teste", type: "corrente", balance: 0 },
        select: { id: true },
      });

      await importarExtrato(contaId, "marco.ofx", OFX);
      const resumo = await resumoDaConciliacao("2027-03");

      const daParada = resumo.contas.find((c) => c.accountId === parada.id)!;
      expect(daParada.situacao).toBe("PARADA");

      const daAtiva = resumo.contas.find((c) => c.accountId === contaId)!;
      expect(daAtiva.linhas).toBe(2);
      expect(daAtiva.situacao).toBe("ABAIXO_DO_MINIMO");
      expect(MINIMO_CONCILIADO).toBe(95);

      // Conta parada NÃO entra na conta de pendências.
      expect(resumo.pendentes).toBe(1);

      await prisma.account.delete({ where: { id: parada.id } });
    });
  });

  it("linha ignorada conta como resolvida no percentual", async () => {
    await asOwner(dono, async () => {
      await importarExtrato(contaId, "marco.ofx", OFX);
      const linhas = await linhasDaConta(contaId, "2027-03");
      expect(linhas).toHaveLength(2);
      for (const l of linhas) await ignorarLinha(l.id, "Conferido fora do sistema");

      const resumo = await resumoDaConciliacao("2027-03");
      const conta = resumo.contas.find((c) => c.accountId === contaId)!;
      expect(conta.percentual).toBe(100);
      expect(conta.situacao).toBe("OK");
    });
  });

  it("o item 8 do checklist deixou de ser 'não medido'", async () => {
    await asOwner(dono, async () => {
      const itens = await montarChecklist("2027-03");
      const item = itens.find((i) => i.id === "conciliacao")!;
      expect(item.situacao).not.toBe("NAO_MEDIDO");
      expect(item.href).toContain("/conciliacao");
    });
  });
});
