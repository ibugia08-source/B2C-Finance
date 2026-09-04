import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  lancarReceitaExtra,
  excluirReceitaExtra,
} from "@/lib/services/extra-revenue";
import { getReceiptsSummary } from "@/lib/services/revenue-metrics";
import { montarDre } from "@/lib/services/dre";
import { isLedgerEnabled, idempotencyKeyOf } from "@/lib/accounting/engine";
import { setLedgerEnabled } from "@/lib/accounting/health";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * RECEITAS EXTRAS — entradas de caixa que não vêm de cobrança a cliente.
 *
 * As regras que importam:
 *  1. o valor entra no EXERCÍCIO informado no cadastro, não no mês do caixa;
 *  2. o fato posta no razão (EXTRA_REVENUE_RECEIVED) e aparece no DRE no
 *     bloco "Receitas extras";
 *  3. excluir estorna o razão — nunca apaga lançamento;
 *  4. mês fechado não aceita lançar nem excluir (evento ECONÔMICO).
 *
 * Competências 2031-xx: exclusivas desta suíte (razão é do workspace).
 */

const COMP_ESCOLHIDA = { competenceYear: 2031, competenceMonth: 3 }; // 2031-03
const CAIXA_EM_OUTRO_MES = new Date(2031, 4, 10); // caixa entra em MAIO
const MARCO = { start: new Date(2031, 2, 1), end: new Date(2031, 3, 1) };
const MAIO = { start: new Date(2031, 4, 1), end: new Date(2031, 5, 1) };

let dono: TestOwner;
let ws: string;
let ligadoAntes = false;

beforeAll(async () => {
  dono = await createOwner();
  ws = await currentWorkspaceId();
  ligadoAntes = await isLedgerEnabled(ws);
  await setLedgerEnabled(ws, true);
});

afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.ledgerEntry.deleteMany({
      where: { ledgerTransaction: { competence: { startsWith: "2031-" } } },
    });
    await prisma.ledgerTransaction.deleteMany({
      where: { competence: { startsWith: "2031-" } },
    });
    await prisma.extraRevenue.deleteMany({ where: { ownerId: dono.id } });
    await prisma.closingPeriod.deleteMany({ where: { competence: "2031-07" } });
  });
  await setLedgerEnabled(ws, ligadoAntes);
  await destroyOwner(dono);
});

describe("receitas extras", () => {
  let idRendimento = "";

  it("entra no exercício informado no cadastro, não no mês do caixa", async () => {
    const r = await asOwner(dono, async () =>
      lancarReceitaExtra({
        description: "Rendimento da aplicação",
        amount: 1234.56,
        ...COMP_ESCOLHIDA,
        receivedAt: CAIXA_EM_OUTRO_MES,
        type: "MANUAL_EXTRA_REVENUE",
        actorEmail: dono.email,
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    idRendimento = r.id;
    expect(r.competence).toBe("2031-03");

    const marco = await asOwner(dono, async () =>
      getReceiptsSummary(MARCO.start, MARCO.end)
    );
    expect(marco.extraRevenueManual).toBeCloseTo(1234.56, 2);
    expect(marco.totalRevenue).toBeCloseTo(1234.56, 2);

    // O mês em que o dinheiro CAIU não conta a receita de novo.
    const maio = await asOwner(dono, async () =>
      getReceiptsSummary(MAIO.start, MAIO.end)
    );
    expect(maio.extraRevenueManual).toBe(0);
  });

  it("posta no razão e aparece no DRE como receita extra", async () => {
    const dre = await asOwner(dono, async () => montarDre("2031-03"));
    const bloco = dre.blocos.find((b) => b.chave === "receita_extra");
    expect(bloco?.total).toBeCloseTo(1234.56, 2);
    expect(dre.receitaTotal).toBeCloseTo(1234.56, 2);
  });

  it("ajuste positivo cai na conta própria do plano (5.2)", async () => {
    const r = await asOwner(dono, async () =>
      lancarReceitaExtra({
        description: "Ajuste de conciliação",
        amount: 200,
        ...COMP_ESCOLHIDA,
        receivedAt: new Date(2031, 2, 15),
        type: "ADJUSTMENT",
        actorEmail: dono.email,
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const chave = idempotencyKeyOf({
      eventType: "EXTRA_REVENUE_RECEIVED",
      sourceType: "ExtraRevenue",
      sourceId: r.id,
      competence: "2031-03",
    });
    const lancamento = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findFirst({
        where: { workspaceId: ws, idempotencyKey: chave },
        include: { entries: { include: { account: true } } },
      })
    );
    expect(lancamento).not.toBeNull();
    const credito = lancamento!.entries.find((e) => Number(e.credit) > 0);
    expect(credito?.account.code).toBe("5.2");
  });

  it("excluir estorna o razão e some das métricas — sem apagar lançamento", async () => {
    const r = await asOwner(dono, async () => excluirReceitaExtra(idRendimento));
    expect(r.ok).toBe(true);

    // Sobrou só o ajuste de 200 na competência.
    const marco = await asOwner(dono, async () =>
      getReceiptsSummary(MARCO.start, MARCO.end)
    );
    expect(marco.extraRevenueManual).toBeCloseTo(200, 2);

    const dre = await asOwner(dono, async () => montarDre("2031-03"));
    const bloco = dre.blocos.find((b) => b.chave === "receita_extra");
    expect(bloco?.total).toBeCloseTo(200, 2);

    // O razão guarda a história: original + estorno, nada apagado.
    const transacoes = await runWithoutScope(async () =>
      prisma.ledgerTransaction.count({
        where: { workspaceId: ws, competence: "2031-03" },
      })
    );
    expect(transacoes).toBe(3); // rendimento + ajuste + REVERSAL do rendimento
  });

  it("mês fechado não aceita lançar receita extra", async () => {
    await runWithoutScope(async () =>
      prisma.closingPeriod.create({
        data: {
          workspaceId: ws,
          scopeType: "WORKSPACE",
          scopeId: "",
          competence: "2031-07",
          state: "CLOSED",
          closedAt: new Date(),
          closedBy: "teste",
        },
      })
    );
    const r = await asOwner(dono, async () =>
      lancarReceitaExtra({
        description: "Tentativa em mês fechado",
        amount: 100,
        competenceYear: 2031,
        competenceMonth: 7,
        receivedAt: new Date(2031, 6, 10),
        type: "OTHER",
        actorEmail: dono.email,
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("fechado");
  });
});
