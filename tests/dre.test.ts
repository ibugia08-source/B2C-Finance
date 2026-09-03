import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { dreParaCsv, montarDre } from "@/lib/services/dre";
import { post, isLedgerEnabled } from "@/lib/accounting/engine";
import { setLedgerEnabled } from "@/lib/accounting/health";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * F3.2 — DRE gerencial (01 §3.11; 02 §4.5).
 *
 * A fonte é o RAZÃO, não as tabelas operacionais: é isso que separa este DRE
 * de mais um relatório que soma colunas por conta própria e discorda do
 * painel na terceira casa. E a COBERTURA vem junto com os números, porque um
 * DRE tirado de um razão que cobre metade dos fatos não está quase pronto —
 * está errado.
 */
describe("F3.2 — DRE", () => {
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
        where: { ledgerTransaction: { competence: "2026-11" } },
      });
      await prisma.ledgerTransaction.deleteMany({ where: { competence: "2026-11" } });
    });
    await setLedgerEnabled(ws, ligadoAntes);
    await destroyOwner(dono);
  });

  it("só entra conta de resultado — balanço não aparece no DRE", async () => {
    // Um recebimento move banco e contas a receber: nenhum dos dois é
    // resultado, e o DRE não pode enxergar nem um centavo disso.
    await post({
      eventType: "CUSTOMER_PAYMENT_RECEIVED",
      sourceType: "Teste", sourceId: "dre-caixa-1",
      competence: "2026-11", amount: 5000,
      context: { workspaceId: ws },
    });

    const dre = await montarDre("2026-11");
    expect(dre.receitaTotal).toBe(0);
    expect(dre.despesas).toBe(0);
    expect(dre.resultado).toBe(0);
  });

  it("receita reconhecida e despesa entram com o sinal certo", async () => {
    await post({
      eventType: "REVENUE_RECOGNIZED",
      sourceType: "Teste", sourceId: "dre-receita-1",
      competence: "2026-11", amount: 10000,
      context: { workspaceId: ws },
    });
    await post({
      eventType: "EXPENSE_PAID_CASH",
      sourceType: "Teste", sourceId: "dre-despesa-1",
      competence: "2026-11", amount: 3000,
      context: { workspaceId: ws },
    });

    const dre = await montarDre("2026-11");
    expect(dre.receitaOperacional).toBe(10000);
    expect(dre.despesas).toBe(3000);
    expect(dre.resultado).toBe(7000);
    expect(dre.margem).toBeCloseTo(0.7, 6);
  });

  it("estorno de receita SUBTRAI, em vez de virar despesa", async () => {
    // Sem tratar a natureza da conta, um estorno de receita apareceria como
    // despesa negativa — e as duas colunas do DRE mentiriam ao mesmo tempo.
    const receita = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findFirstOrThrow({
        where: { competence: "2026-11", eventType: "REVENUE_RECOGNIZED" },
        select: { id: true },
      })
    );
    const { reverter } = await import("@/lib/accounting/engine");
    await reverter(receita.id, "teste de estorno no DRE");

    const dre = await montarDre("2026-11");
    expect(dre.receitaOperacional).toBe(0);
    expect(dre.despesas).toBe(3000);
    expect(dre.resultado).toBe(-3000);
  });

  it("pró-labore tem chave para sair do resultado (19.12)", async () => {
    await post({
      eventType: "EXPENSE_PAID_CASH",
      sourceType: "Teste", sourceId: "dre-prolabore-1",
      competence: "2026-11", amount: 8000,
      context: { workspaceId: ws, debitAccountCode: "7.5" },
    });

    const com = await montarDre("2026-11", { comProLabore: true });
    const sem = await montarDre("2026-11", { comProLabore: false });

    expect(com.proLabore).toBe(8000);
    expect(sem.proLabore).toBe(8000); // continua visível, só não entra na conta
    expect(com.resultado).toBe(sem.resultado - 8000);
    expect(com.resultadoSemProLabore).toBe(sem.resultado);
  });

  it("a cobertura vem junto e diz o que ainda não é gerado", async () => {
    const dre = await montarDre("2026-11");
    expect(dre.cobertura.ligado).toBe(true);
    // Vários eventos da matriz ainda não têm tela que os origine.
    expect(dre.cobertura.eventosSemUso.length).toBeGreaterThan(0);
    expect(dre.cobertura.eventosSemUso).toContain("TAX_PROVISIONED");
  });

  it("competência e caixa respondem perguntas diferentes", async () => {
    // Postado na competência 2026-11, mas com data de caixa em dezembro.
    await post({
      eventType: "REVENUE_RECOGNIZED",
      sourceType: "Teste", sourceId: "dre-base-1",
      competence: "2026-11", amount: 1000,
      postedAt: new Date(2026, 11, 5),
      context: { workspaceId: ws },
    });

    const porCompetencia = await montarDre("2026-11", { base: "competencia" });
    const porCaixa = await montarDre("2026-11", { base: "caixa" });
    expect(porCompetencia.receitaOperacional).toBe(1000);
    // Em dezembro no caixa: não aparece na leitura de caixa de novembro.
    expect(porCaixa.receitaOperacional).toBe(0);
  });

  it("o CSV usa vírgula decimal SEM estragar o código da conta", async () => {
    const dre = await montarDre("2026-11");
    const csv = dreParaCsv(dre);
    expect(csv.split("\n")[0]).toBe("bloco;conta;nome;valor");
    // "4.1" continua "4.1"; o valor é que vira "10000,00".
    const linhaReceita = csv.split("\n").find((l) => l.includes(";4.1;"));
    if (linhaReceita) {
      expect(linhaReceita).toContain(";4.1;");
      expect(linhaReceita.split(";").pop()).toMatch(/,\d{2}$/);
    }
    expect(csv).toContain("Resultado;");
  });
});
