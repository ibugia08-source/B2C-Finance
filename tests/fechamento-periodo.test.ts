import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { permiteEvento, categoriaDe, ROTULO_DO_PERIODO } from "@/lib/periods/events";
import {
  assertPeriodAllows, fecharPeriodo, iniciarFechamento, marcarReconferido,
  motivosDeReconferencia, periodoDe, reabrirParaOperacao, reabrirPeriodo,
} from "@/lib/services/closing-period";
import { settleBillingPayment } from "@/lib/services/payment-accounting";
import { competenciaDoCaixa } from "@/lib/engines/payment-engine";
import { guardPeriod } from "@/lib/engines/guards";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * F2.1 — ClosingPeriod e a guarda de período.
 *
 * A regra mais delicada do fechamento é a de 01 §5.6, e é ela que a maior
 * parte destes testes protege: fechar agosto NÃO pode travar o recebimento,
 * em outubro, de uma cobrança de agosto. Se travar, a operação de cobrança
 * para todo dia 6 e o sistema é abandonado no primeiro fechamento.
 */

describe("F2.1 — a regra pura, sem banco", () => {
  it("mês aberto aceita tudo", () => {
    for (const e of ["REVENUE_RECOGNIZED", "CUSTOMER_PAYMENT_RECEIVED", "RECONCILIATION"]) {
      expect(permiteEvento("OPEN", e).ok).toBe(true);
    }
  });

  it("em fechamento: só as pendências do próprio fechamento", () => {
    expect(permiteEvento("SOFT_CLOSED", "RECONCILIATION").ok).toBe(true);
    expect(permiteEvento("SOFT_CLOSED", "CLOSING_ADJUSTMENT").ok).toBe(true);
    expect(permiteEvento("SOFT_CLOSED", "REVENUE_RECOGNIZED").ok).toBe(false);
    expect(permiteEvento("SOFT_CLOSED", "CUSTOMER_PAYMENT_RECEIVED").ok).toBe(false);
  });

  it("fechado bloqueia econômico E caixa NAQUELA competência", () => {
    expect(permiteEvento("CLOSED", "REVENUE_RECOGNIZED").ok).toBe(false);
    expect(permiteEvento("CLOSED", "CUSTOMER_PAYMENT_RECEIVED").ok).toBe(false);
  });

  it("a mensagem do caixa ENSINA a saída, não só recusa", () => {
    const r = permiteEvento("CLOSED", "CUSTOMER_PAYMENT_RECEIVED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mês em que o dinheiro entrou/i);
  });

  it("operacional nunca depende do fechamento", () => {
    // Avaliar cliente ou concluir onboarding não mexe em número nenhum;
    // travá-los faria o gestor parar de trabalhar por causa da contabilidade.
    for (const estado of ["OPEN", "SOFT_CLOSED", "CLOSED", "REOPENED"] as const) {
      expect(permiteEvento(estado, "MONTHLY_EVALUATION").ok).toBe(true);
      expect(permiteEvento(estado, "ONBOARDING").ok).toBe(true);
    }
  });

  it("reaberto volta a aceitar — foi reaberto para isso", () => {
    expect(permiteEvento("REOPENED", "REVENUE_RECOGNIZED").ok).toBe(true);
  });

  it("evento desconhecido é tratado como econômico (falha segura)", () => {
    expect(categoriaDe("EVENTO_QUE_ALGUEM_ESQUECEU")).toBe("ECONOMICO");
    expect(permiteEvento("CLOSED", "EVENTO_QUE_ALGUEM_ESQUECEU").ok).toBe(false);
  });

  it("os rótulos de tela não usam nome técnico (01 §5.2)", () => {
    expect(Object.values(ROTULO_DO_PERIODO)).toEqual([
      "Aberto", "Em fechamento", "Fechado", "Reaberto",
    ]);
  });
});

describe("F2.1 — o estado no banco", () => {
  let dono: TestOwner;
  const MES = "2026-04";
  const POSTERIOR = "2026-05";

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    const ws = await currentWorkspaceId();
    await runWithoutScope(async () =>
      prisma.closingPeriod.deleteMany({ where: { workspaceId: ws } })
    );
    await destroyOwner(dono);
  });
  beforeEach(async () => {
    const ws = await currentWorkspaceId();
    await runWithoutScope(async () =>
      prisma.closingPeriod.deleteMany({ where: { workspaceId: ws } })
    );
  });

  it("competência sem linha é ABERTA, e não existe no banco", async () => {
    const p = await periodoDe("2026-01");
    expect(p.estado).toBe("OPEN");
    expect(p.registrado).toBe(false);
  });

  it("o ciclo abrir → em fechamento → fechado grava quem e quando", async () => {
    await iniciarFechamento(MES, "Israel");
    expect((await periodoDe(MES)).estado).toBe("SOFT_CLOSED");

    await fecharPeriodo(MES, "Israel");
    const p = await periodoDe(MES);
    expect(p.estado).toBe("CLOSED");
    expect(p.fechadoPor).toBe("Israel");
    expect(p.fechadoEm).toBeTruthy();
  });

  it("reabrir exige motivo — e não é só a tela que exige", async () => {
    await fecharPeriodo(MES, "Israel");
    const curto = await reabrirPeriodo(MES, "erro", "Israel");
    expect(curto.ok).toBe(false);

    // A trava do banco, provada por fora da aplicação.
    const ws = await currentWorkspaceId();
    await expect(
      runWithoutScope(async () =>
        prisma.$executeRawUnsafe(
          `UPDATE "ClosingPeriod" SET state='REOPENED', "reopenReason"=NULL
             WHERE "workspaceId"=$1 AND competence=$2`,
          ws, MES
        )
      )
    ).rejects.toThrow();
  });

  it("reabrir marca os meses posteriores JÁ FECHADOS para reconferência", async () => {
    // O esquecimento clássico: reabrir agosto e deixar setembro e outubro
    // parecendo intactos, quando os números deles saíram de agosto.
    await fecharPeriodo(MES, "Israel");
    await fecharPeriodo(POSTERIOR, "Israel");

    const r = await reabrirPeriodo(MES, "nota lançada no mês errado", "Israel");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.marcados).toBe(1);

    const reaberto = await periodoDe(MES);
    expect(reaberto.estado).toBe("REOPENED");
    expect(reaberto.versao).toBe(2);
    // O reaberto NÃO se marca a si mesmo: ele é o que está sendo corrigido.
    expect(reaberto.precisaRevalidar).toBe(false);

    const posterior = await periodoDe(POSTERIOR);
    expect(posterior.precisaRevalidar).toBe(true);
    // Marcado, não apagado nem reaberto (§5.5).
    expect(posterior.estado).toBe("CLOSED");
  });

  it("só dá para reabrir o que está fechado", async () => {
    await iniciarFechamento(MES, "Israel");
    const r = await reabrirPeriodo(MES, "quero mexer nisso aqui", "Israel");
    expect(r.ok).toBe(false);
    await reabrirParaOperacao(MES);
  });

  it("a guarda lê o estado real", async () => {
    expect((await assertPeriodAllows("REVENUE_RECOGNIZED", MES)).ok).toBe(true);
    await fecharPeriodo(MES, "Israel");
    expect((await assertPeriodAllows("REVENUE_RECOGNIZED", MES)).ok).toBe(false);
  });
});

describe("F2.1 — §5.6: fechar o mês NÃO trava a cobrança", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    const ws = await currentWorkspaceId();
    await runWithoutScope(async () =>
      prisma.closingPeriod.deleteMany({ where: { workspaceId: ws } })
    );
    await destroyOwner(dono);
  });

  it("o motor pergunta pelo MÊS DO CAIXA, não pelo da cobrança", () => {
    // A regra inteira de §5.6 cabe nesta linha: o pagamento de 8 de julho
    // pergunta por julho, mesmo quitando uma cobrança de junho.
    expect(competenciaDoCaixa(new Date(2026, 6, 8))).toBe("2026-07");
  });

  it("junho fechado NÃO impede receber em julho uma cobrança de junho", async () => {
    await fecharPeriodo("2026-06", "Israel");
    const g = await guardPeriod("CUSTOMER_PAYMENT_RECEIVED", competenciaDoCaixa(new Date(2026, 6, 8)));
    expect(g.ok).toBe(true);

    // E a liquidação em si acontece: a cobrança de junho fica paga.
    const cliente = await createMrrClient(dono, { name: "Pagou depois do fechamento" });
    const cob = await createBilling(dono, cliente.id, { month: 6, year: 2026, amount: 900 });
    const r = await asOwner(dono, async () =>
      settleBillingPayment({
        billingId: cob.id, amount: 900, paidAt: new Date(2026, 6, 8),
        method: "PIX", accountId: null, notes: null,
      })
    );
    expect(r.ok).toBe(true);
    const b = await asOwner(dono, async () =>
      prisma.billing.findUniqueOrThrow({ where: { id: cob.id } })
    );
    expect(b.status).toBe("PAID");
  });

  it("mas receber DENTRO de um mês fechado é recusado pela guarda", async () => {
    await fecharPeriodo("2026-07", "Israel");
    const g = await guardPeriod("CUSTOMER_PAYMENT_RECEIVED", competenciaDoCaixa(new Date(2026, 6, 20)));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.error).toMatch(/fechado/i);
  });
});

describe("F2.6 — reabertura completa: rastro e reconferência", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    const ws = await currentWorkspaceId();
    await runWithoutScope(async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" DISABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.snapshot.deleteMany({ where: { workspaceId: ws } });
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" ENABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.closingPeriod.deleteMany({ where: { workspaceId: ws } });
    });
    await destroyOwner(dono);
  });

  it("a marca vem com o rastro: qual mês, que versão, quem e por quê", async () => {
    await asOwner(dono, async () => fecharPeriodo("2026-01", "Israel"));
    await asOwner(dono, async () => fecharPeriodo("2026-02", "Israel"));

    await asOwner(dono, async () =>
      reabrirPeriodo("2026-01", "nota de janeiro lançada em fevereiro", "Israel")
    );

    const motivos = await asOwner(dono, async () => motivosDeReconferencia("2026-02"));
    expect(motivos).toHaveLength(1);
    expect(motivos[0].dependsOnCompetence).toBe("2026-01");
    expect(motivos[0].originVersion).toBe(2);
    expect(motivos[0].reason).toMatch(/nota de janeiro/);
    expect(motivos[0].markedBy).toBe("Israel");
  });

  it("reconferir exige dizer o que foi conferido", async () => {
    const curto = await asOwner(dono, async () =>
      marcarReconferido("2026-02", "ok", "Israel")
    );
    expect(curto.ok).toBe(false);
  });

  it("reconferido tira a marca e fecha o rastro sem apagá-lo", async () => {
    const r = await asOwner(dono, async () =>
      marcarReconferido("2026-02", "refiz o resultado e bate com o fechamento", "Israel")
    );
    expect(r.ok).toBe(true);

    const p = await asOwner(dono, async () => periodoDe("2026-02"));
    expect(p.precisaRevalidar).toBe(false);

    // A marca sai; o RASTRO fica, com quem conferiu e o quê.
    const abertos = await asOwner(dono, async () => motivosDeReconferencia("2026-02"));
    expect(abertos).toHaveLength(0);

    const ws = await currentWorkspaceId();
    const todos = await runWithoutScope(async () =>
      prisma.snapshotDependency.findMany({
        where: { snapshot: { workspaceId: ws, competence: "2026-02" } },
      })
    );
    expect(todos).toHaveLength(1);
    expect(todos[0].clearedBy).toBe("Israel");
    expect(todos[0].clearNote).toMatch(/refiz o resultado/);
  });
});
