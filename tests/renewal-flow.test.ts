import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner,
  createMrrClient, asOwner, type TestOwner,
} from "./support/db";

/**
 * FLUXO DE RENOVAÇÃO — ref. 01 §6.2 e §3.5.
 *
 * renewClientFlow é Server Action: exige sessão e invalida cache. Aqui a
 * autenticação vira um espectador com todas as permissões e a invalidação
 * vira no-op — o que fica sob teste é a REGRA: estender vigência com clamp,
 * normalizar a modalidade, lançar a cobrança sem duplicar e registrar o
 * histórico auditável.
 */

vi.mock("@/lib/auth/viewer", () => ({
  requirePermission: async () => ({
    id: "teste", name: "Teste", email: "teste@b2c.local",
    role: "ADMIN", permissions: [], personId: null,
  }),
  can: () => true,
}));
vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {},
  revalidateFinance: () => {},
  revalidateClients: () => {},
}));

let owner: TestOwner;
let renewClientFlow: typeof import("@/lib/actions/renewals")["renewClientFlow"];

beforeAll(async () => {
  owner = await createOwner();
  ({ renewClientFlow } = await import("@/lib/actions/renewals"));
});
afterAll(async () => {
  await destroyOwner(owner);
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const readClient = (id: string) =>
  runWithoutScope(async () =>
    prisma.client.findUniqueOrThrow({
      where: { id },
      select: {
        status: true, modality: true, monthlyValue: true, paymentDay: true,
        totalContractValue: true, contractMonths: true, renewalMonth: true,
        churnedAt: true,
      },
    })
  );

describe("renewClientFlow — renovação MRR", () => {
  it("reativa o cliente, mantém o ciclo mensal e grava o histórico", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1000, paymentDay: 10 });
    await runWithoutScope(async () =>
      prisma.client.update({
        where: { id: c.id },
        data: { status: "CHURNED", churnedAt: new Date(2026, 1, 1) },
      })
    );

    const res = await asOwner(owner, async () =>
      renewClientFlow(form({
        clientId: c.id, months: "12", modality: "MRR",
        monthlyValue: "1.200,00", paymentDay: "15", launch: "0",
      }))
    );
    expect(res.ok).toBe(true);

    const cli = await readClient(c.id);
    expect(cli.status).toBe("ACTIVE");
    expect(cli.churnedAt).toBeNull();
    expect(cli.modality).toBe("MRR");
    expect(Number(cli.monthlyValue)).toBe(1200);
    expect(cli.paymentDay).toBe(15);
    expect(cli.contractMonths).toBe(12);
    // Normalização MRR: valor total do contrato é zerado.
    expect(cli.totalContractValue).toBeNull();

    const renewals = await runWithoutScope(async () =>
      prisma.clientRenewal.findMany({
        where: { clientId: c.id },
        select: { months: true, totalValue: true, modality: true },
      })
    );
    expect(renewals).toHaveLength(1);
    expect(renewals[0].months).toBe(12);
    expect(Number(renewals[0].totalValue)).toBe(14400); // 1.200 × 12
  });

  it("lança a mensalidade da competência escolhida sem duplicar", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 800, paymentDay: 5 });
    const res = await asOwner(owner, async () =>
      renewClientFlow(form({
        clientId: c.id, months: "6", modality: "MRR",
        monthlyValue: "950,00", paymentDay: "5",
        launch: "1", competence: "2026-07", payStatus: "aberto",
      }))
    );
    expect(res.ok).toBe(true);

    const billings = await runWithoutScope(async () =>
      prisma.billing.findMany({
        where: { clientId: c.id, competenceMonth: 7, competenceYear: 2026 },
        select: { amount: true, status: true, revenueType: true },
      })
    );
    expect(billings).toHaveLength(1);
    expect(Number(billings[0].amount)).toBe(950); // valor NOVO, não o antigo
    expect(billings[0].revenueType).toBe("MRR");
  });
});

describe("renewClientFlow — renovação TCV", () => {
  it("troca a modalidade e zera a mensalidade do cadastro", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 500, paymentDay: 10 });
    const res = await asOwner(owner, async () =>
      renewClientFlow(form({
        clientId: c.id, months: "12", modality: "TCV",
        totalValue: "9.000,00", launch: "0",
      }))
    );
    expect(res.ok).toBe(true);

    const cli = await readClient(c.id);
    expect(cli.modality).toBe("TCV");
    expect(Number(cli.totalContractValue)).toBe(9000);
    expect(cli.monthlyValue).toBeNull();
    expect(cli.paymentDay).toBeNull();
  });
});

describe("renewClientFlow — guarda anti-duplo-envio (01 §3.5)", () => {
  it("recusa a segunda renovação do mesmo cliente em poucos minutos", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1000, paymentDay: 10 });
    const campos = {
      clientId: c.id, months: "12", modality: "MRR",
      monthlyValue: "1.000,00", paymentDay: "10",
      launch: "1", competence: "2026-08", payStatus: "aberto",
    };

    const first = await asOwner(owner, async () => renewClientFlow(form(campos)));
    expect(first.ok).toBe(true);

    const second = await asOwner(owner, async () => renewClientFlow(form(campos)));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/poucos minutos/i);

    // O efeito importante: nada foi duplicado.
    const [renewals, billings] = await runWithoutScope(async () =>
      Promise.all([
        prisma.clientRenewal.count({ where: { clientId: c.id } }),
        prisma.billing.count({
          where: { clientId: c.id, competenceMonth: 8, competenceYear: 2026 },
        }),
      ])
    );
    expect(renewals).toBe(1);
    expect(billings).toBe(1);
  });
});

describe("renewClientFlow — validações", () => {
  it("recusa MRR sem mensalidade e TCV sem valor total", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1000 });
    const semMensal = await asOwner(owner, async () =>
      renewClientFlow(form({ clientId: c.id, months: "12", modality: "MRR", paymentDay: "10", launch: "0" }))
    );
    expect(semMensal.ok).toBe(false);

    const semTotal = await asOwner(owner, async () =>
      renewClientFlow(form({ clientId: c.id, months: "12", modality: "TCV", launch: "0" }))
    );
    expect(semTotal.ok).toBe(false);
  });
});
