import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { provisionar, sugerirProvisoes, marcarReservaFeita } from "@/lib/services/tax-provision";
import { isLedgerEnabled } from "@/lib/accounting/engine";
import { setLedgerEnabled } from "@/lib/accounting/health";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { montarDre } from "@/lib/services/dre";
import { getLiquidez } from "@/lib/services/liquidity";

/**
 * F3.3 — provisão tributária e reserva (01 §3.8) + F3.11 (liquidez, 19.34).
 *
 * A regra que estes testes protegem: provisão e reserva são EVENTOS
 * INDEPENDENTES. Quem trata as duas como uma só conta o imposto DUAS VEZES no
 * resultado — uma como despesa tributária e outra como saída de caixa. O erro
 * é invisível no extrato e só aparece quando o lucro do ano não bate com o
 * que o contador apurou.
 */
describe("F3.3 — provisão x reserva", () => {
  let dono: TestOwner;
  let ws: string;
  let ligadoAntes = false;
  let entidadeId: string;
  let settingsAntes: any;

  beforeAll(async () => {
    dono = await createOwner();
    ws = await currentWorkspaceId();
    ligadoAntes = await isLedgerEnabled(ws);
    await setLedgerEnabled(ws, true);
    const e = await runWithoutScope(async () =>
      prisma.legalEntity.findFirstOrThrow({ where: { workspaceId: ws } })
    );
    entidadeId = e.id;
    settingsAntes = e.taxSettings;
    await runWithoutScope(async () =>
      prisma.legalEntity.update({
        where: { id: entidadeId },
        data: { taxSettings: { aliquotaEfetiva: 6 } },
      })
    );
  });

  afterAll(async () => {
    await runWithoutScope(async () => {
      await prisma.taxProvision.deleteMany({ where: { competence: "2026-12" } });
      await prisma.ledgerEntry.deleteMany({
        where: { ledgerTransaction: { competence: "2026-12" } },
      });
      await prisma.ledgerTransaction.deleteMany({ where: { competence: "2026-12" } });
      await prisma.legalEntity.update({
        where: { id: entidadeId },
        data: { taxSettings: settingsAntes ?? undefined },
      });
    });
    await setLedgerEnabled(ws, ligadoAntes);
    await destroyOwner(dono);
  });

  it("sem alíquota configurada o sistema DIZ isso em vez de inventar", async () => {
    await runWithoutScope(async () =>
      prisma.legalEntity.update({ where: { id: entidadeId }, data: { taxSettings: {} } })
    );
    const s = await asOwner(dono, async () => sugerirProvisoes("2026-12"));
    expect(s[0].semAliquota).toBe(true);
    expect(s[0].valor).toBe(0);

    const r = await asOwner(dono, async () => provisionar("2026-12", entidadeId, "Israel"));
    expect(r.ok).toBe(false);

    await runWithoutScope(async () =>
      prisma.legalEntity.update({
        where: { id: entidadeId },
        data: { taxSettings: { aliquotaEfetiva: 6 } },
      })
    );
  });

  it("a base é o faturamento do mês e a conta é base × alíquota", async () => {
    const cliente = await createMrrClient(dono, { name: "Base de imposto" });
    await createBilling(dono, cliente.id, { month: 12, year: 2026, amount: 10000 });

    const s = await asOwner(dono, async () => sugerirProvisoes("2026-12"));
    expect(s[0].base).toBe(10000);
    expect(s[0].aliquota).toBe(6);
    expect(s[0].valor).toBe(600);
  });

  it("provisionar entra no RESULTADO — e a reserva NÃO", async () => {
    const r = await asOwner(dono, async () => provisionar("2026-12", entidadeId, "Israel"));
    expect(r.ok).toBe(true);

    const dre = await asOwner(dono, async () => montarDre("2026-12"));
    // A provisão é despesa tributária: entra no DRE.
    expect(dre.despesas).toBeGreaterThanOrEqual(600);

    // Marcar a reserva NÃO mexe no resultado — este é o teste que impede o
    // imposto de ser contado duas vezes.
    await asOwner(dono, async () => marcarReservaFeita("2026-12", entidadeId, "Israel"));
    const depois = await asOwner(dono, async () => montarDre("2026-12"));
    expect(depois.despesas).toBe(dre.despesas);
    expect(depois.resultado).toBe(dre.resultado);
  });

  it("provisionar duas vezes não duplica a despesa", async () => {
    const antes = await asOwner(dono, async () => montarDre("2026-12"));
    await asOwner(dono, async () => provisionar("2026-12", entidadeId, "Israel"));
    const depois = await asOwner(dono, async () => montarDre("2026-12"));
    expect(depois.despesas).toBe(antes.despesas);
  });

  it("o sistema NUNCA transfere: ele anota que alguém transferiu", async () => {
    const p = await asOwner(dono, async () =>
      prisma.taxProvision.findFirstOrThrow({ where: { competence: "2026-12" } })
    );
    expect(p.reserveDoneBy).toBe("Israel");
    expect(p.reserveDoneAt).toBeTruthy();
    // Nenhum movimento de caixa foi criado pelo sistema.
    const movimentos = await asOwner(dono, async () =>
      prisma.cashBoxMovement.count({ where: { description: { contains: "imposto" } } })
    );
    expect(movimentos).toBe(0);
  });
});

describe("F3.11 — reserva restrita sai da liquidez (19.34)", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("o disponível é contas + reservas MENOS as restritas", async () => {
    await asOwner(dono, async () => {
      await prisma.cashBox.create({
        data: { name: "Reserva livre", currentAmount: 5000, type: "COMPANY" },
      });
      await prisma.cashBox.create({
        data: { name: "Reserva de impostos", currentAmount: 3000, type: "COMPANY", restricted: true },
      });
    });

    const l = await asOwner(dono, async () => getLiquidez(new Date().toISOString()));
    expect(l.reservas).toBe(8000);
    expect(l.reservado).toBe(3000);
    // Mostrar 8000 como disponível é o que faz alguém aprovar uma despesa
    // contra o imposto do mês seguinte.
    expect(l.disponivel).toBe(l.contas + 5000);
  });

  it("a composição continua mostrando TUDO, marcando o que é restrito", async () => {
    const l = await asOwner(dono, async () => getLiquidez(new Date().toISOString()));
    const restrita = l.itens.find((i) => i.label === "Reserva de impostos");
    expect(restrita?.restrita).toBe(true);
    expect(l.itens.some((i) => i.label === "Reserva livre" && !i.restrita)).toBe(true);
  });
});
