import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, asOwner, type TestOwner,
} from "./support/db";
import { currentYearMonth, fromMonthIndex, monthIndex } from "@/lib/renewal-expectation";

/**
 * AUDITORIA DA CARTEIRA (25/09/2026) — o que cada achado corrigido garante.
 */

vi.mock("@/lib/auth/viewer", () => {
  const v = { id: "teste", name: "Teste", email: "teste@b2c.local", role: "ADMIN", permissions: [], personId: null };
  return {
    requirePermission: async () => v,
    tryPermission: async () => v,
    getViewer: async () => v,
    NO_PERMISSION: { ok: false, error: "Sem permissão." },
    can: () => true,
  };
});
vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {}, revalidateFinance: () => {}, revalidateClients: () => {},
  revalidateCatalog: () => {},
}));
vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

let owner: TestOwner;
let acoes: typeof import("@/lib/actions/clients");
let upsells: typeof import("@/lib/actions/upsells");
let contratos: typeof import("@/lib/actions/contracts");
const HOJE = currentYearMonth();

beforeAll(async () => {
  owner = await createOwner();
  acoes = await import("@/lib/actions/clients");
  upsells = await import("@/lib/actions/upsells");
  contratos = await import("@/lib/actions/contracts");
});
afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.upsellService.deleteMany({ where: { upsell: { ownerId: owner.id } } });
    await prisma.upsell.deleteMany({ where: { ownerId: owner.id } });
  });
  await destroyOwner(owner);
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Cliente MRR com prazo, cadastrado pelo fluxo real (relação, termo, contrato, 12 cobranças). */
async function cadastrarMrr(nome: string): Promise<string> {
  const r = await asOwner(owner, async () =>
    acoes.saveClient(form({
      name: nome, status: "ACTIVE", paymentModel: "MRR", monthlyValue: "1.000,00",
      paymentDay: "10", contractMonths: "12",
      startedAt: `01/${String(HOJE.month).padStart(2, "0")}/${HOJE.year}`,
    }))
  );
  expect(r.ok, (r as any).error).toBe(true);
  return (r as any).id as string;
}

const relacao = (clientId: string) =>
  runWithoutScope(async () =>
    prisma.clientAgencyRelationship.findFirstOrThrow({
      where: { clientId },
      select: { lifecycleStatus: true, churnedAt: true, currentCommercialTermId: true, id: true },
    })
  );

describe("transição de status pelo caminho único", () => {
  it("Perdido pelo select encerra relação e termo e cancela as mensalidades futuras sem pagamento", async () => {
    const id = await cadastrarMrr("Sai Pelo Select");
    const antes = await relacao(id);
    expect(antes.currentCommercialTermId).toBeTruthy();
    const futurasAntes = await runWithoutScope(async () =>
      prisma.billing.count({ where: { clientId: id, status: { in: ["PENDING", "OVERDUE"] } } })
    );
    expect(futurasAntes).toBeGreaterThan(1);

    expect((await asOwner(owner, async () => acoes.setClientStatus(id, "CHURNED", "preço"))).ok).toBe(true);

    const depois = await relacao(id);
    expect(depois.lifecycleStatus).toBe("CHURNED");
    expect(depois.churnedAt).toBeTruthy();
    expect(depois.currentCommercialTermId).toBeNull();
    const termo = await runWithoutScope(async () =>
      prisma.commercialTerm.findUniqueOrThrow({ where: { id: antes.currentCommercialTermId! }, select: { validTo: true } })
    );
    expect(termo.validTo).toBeTruthy();

    const abertasDepois = await runWithoutScope(async () =>
      prisma.billing.findMany({
        where: { clientId: id, status: { in: ["PENDING", "OVERDUE"] } },
        select: { competenceYear: true, competenceMonth: true },
      })
    );
    // Só sobra o que é do mês da saída (ou anterior); nada depois dele.
    for (const b of abertasDepois) {
      expect(monthIndex({ year: b.competenceYear, month: b.competenceMonth })).toBeLessThanOrEqual(monthIndex(HOJE));
    }
    expect(await runWithoutScope(async () => prisma.clientLoss.count({ where: { clientId: id } }))).toBe(1);
  });

  it("Pausado pelo select fecha o termo; voltar a Ativo retoma com termo novo", async () => {
    const id = await cadastrarMrr("Pausa Pelo Select");
    const t0 = (await relacao(id)).currentCommercialTermId;
    expect((await asOwner(owner, async () => acoes.setClientStatus(id, "PAUSED"))).ok).toBe(true);
    const pausada = await relacao(id);
    expect(pausada.lifecycleStatus).toBe("PAUSED");
    expect(pausada.currentCommercialTermId).toBeNull();
    expect((await asOwner(owner, async () => acoes.setClientStatus(id, "ACTIVE"))).ok).toBe(true);
    const ativa = await relacao(id);
    expect(ativa.lifecycleStatus).toBe("ACTIVE");
    expect(ativa.currentCommercialTermId).toBeTruthy();
    expect(ativa.currentCommercialTermId).not.toBe(t0);
  });

  it("status em massa: perda só para quem muda, e o churnedAt de quem já saiu é preservado", async () => {
    const jaSaiu = await cadastrarMrr("Já Saiu Antes");
    const vaiSair = await cadastrarMrr("Vai Sair Agora");
    const antiga = new Date(Date.UTC(2026, 2, 15, 12));
    expect((await asOwner(owner, async () => acoes.markClientLost(jaSaiu, "2026-03-15", "x"))).ok).toBe(true);
    await asOwner(owner, async () => prisma.client.update({ where: { id: jaSaiu }, data: { churnedAt: antiga } }));

    expect((await asOwner(owner, async () => acoes.bulkUpdateClients({ ids: [jaSaiu, vaiSair], status: "CHURNED" }))).ok).toBe(true);
    const lidos = await runWithoutScope(async () =>
      prisma.client.findMany({ where: { id: { in: [jaSaiu, vaiSair] } }, select: { id: true, churnedAt: true } })
    );
    expect(lidos.find((c) => c.id === jaSaiu)!.churnedAt!.toISOString()).toBe(antiga.toISOString());
    expect(await runWithoutScope(async () => prisma.clientLoss.count({ where: { clientId: jaSaiu } }))).toBe(1);
    expect(await runWithoutScope(async () => prisma.clientLoss.count({ where: { clientId: vaiSair } }))).toBe(1);
    expect((await relacao(vaiSair)).lifecycleStatus).toBe("CHURNED");
  });

  it("Perdido pela edição do cadastro também encerra a relação", async () => {
    const id = await cadastrarMrr("Sai Pela Edição");
    const r = await asOwner(owner, async () =>
      acoes.saveClient(form({
        id, name: "Sai Pela Edição", status: "CHURNED", paymentModel: "MRR", monthlyValue: "1.000,00",
        paymentDay: "10", contractMonths: "12",
        startedAt: `01/${String(HOJE.month).padStart(2, "0")}/${HOJE.year}`,
      }))
    );
    expect(r.ok, (r as any).error).toBe(true);
    expect((await relacao(id)).lifecycleStatus).toBe("CHURNED");
    expect(await runWithoutScope(async () => prisma.clientLoss.count({ where: { clientId: id } }))).toBe(1);
  });
});

describe("responsável: sempre o par colaborador + nome", () => {
  it("em massa por colaborador grava id e nome; salvar cliente só-texto preserva o nome", async () => {
    const emp = await asOwner(owner, async () =>
      prisma.employee.create({ data: { name: "Marina Souza", active: true }, select: { id: true } })
    );
    const c = await createMrrClient(owner, { name: "Resp Em Massa" });
    expect((await asOwner(owner, async () => acoes.bulkUpdateClients({ ids: [c.id], salesOwnerId: emp.id }))).ok).toBe(true);
    const lido = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { salesOwner: true, salesOwnerId: true } })
    );
    expect(lido).toEqual({ salesOwner: "Marina Souza", salesOwnerId: emp.id });

    const soTexto = await createMrrClient(owner, { name: "Resp Só Texto" });
    await asOwner(owner, async () =>
      prisma.client.update({ where: { id: soTexto.id }, data: { salesOwner: "Israel Importado", salesOwnerId: null } })
    );
    const r = await asOwner(owner, async () =>
      acoes.saveClient(form({
        id: soTexto.id, name: "Resp Só Texto", status: "ACTIVE", modality: "MRR",
        monthlyValue: "500,00", paymentDay: "5", salesOwnerId: "__texto__", phone: "71 90000-0000",
      }))
    );
    expect(r.ok, (r as any).error).toBe(true);
    const depois = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: soTexto.id }, select: { salesOwner: true } })
    );
    expect(depois.salesOwner).toBe("Israel Importado");
  });
});

describe("upsell vendido", () => {
  it("sair de Vendido pelo formulário cancela a cobrança sem pagamento; excluir com pagamento é recusado", async () => {
    const c = await createMrrClient(owner, { name: "Cliente Upsell" });
    const u = await asOwner(owner, async () =>
      prisma.upsell.create({ data: { clientId: c.id, title: "Tráfego extra", value: 800, status: "OPPORTUNITY" }, select: { id: true } })
    );
    const venda = await asOwner(owner, async () =>
      upsells.setUpsellStatus(u.id, "WON", { launchBilling: true, month: HOJE.month, year: HOJE.year })
    );
    expect(venda.ok, (venda as any).error).toBe(true);
    const billingId = (await runWithoutScope(async () =>
      prisma.upsell.findUniqueOrThrow({ where: { id: u.id }, select: { billingId: true } })
    )).billingId!;
    expect(billingId).toBeTruthy();

    const desfaz = await asOwner(owner, async () =>
      upsells.saveUpsell(form({ id: u.id, clientId: c.id, title: "Tráfego extra", value: "800,00", status: "OPPORTUNITY" }))
    );
    expect(desfaz.ok, (desfaz as any).error).toBe(true);
    const b = await runWithoutScope(async () =>
      prisma.billing.findUniqueOrThrow({ where: { id: billingId }, select: { status: true } })
    );
    expect(b.status).toBe("CANCELED");

    // Nova venda com pagamento: excluir é recusado.
    await asOwner(owner, async () => upsells.setUpsellStatus(u.id, "WON", { launchBilling: true, month: HOJE.month, year: HOJE.year }));
    const novo = (await runWithoutScope(async () =>
      prisma.upsell.findUniqueOrThrow({ where: { id: u.id }, select: { billingId: true } })
    )).billingId!;
    await runWithoutScope(async () => prisma.billing.update({ where: { id: novo }, data: { paidTotal: 100, status: "PARTIAL" } }));
    const del = await asOwner(owner, async () => upsells.deleteUpsell(u.id));
    expect(del.ok).toBe(false);
  });
});

describe("contrato cancelado", () => {
  it("cancela as mensalidades futuras sem pagamento do contrato", async () => {
    const id = await cadastrarMrr("Contrato Cancelado");
    const ct = await runWithoutScope(async () =>
      prisma.contract.findFirstOrThrow({ where: { clientId: id }, select: { id: true } })
    );
    expect((await asOwner(owner, async () => contratos.cancelContract(ct.id))).ok).toBe(true);
    const prox = fromMonthIndex(monthIndex(HOJE) + 1);
    const futuras = await runWithoutScope(async () =>
      prisma.billing.count({
        where: {
          contractId: ct.id, status: { in: ["PENDING", "OVERDUE"] },
          OR: [
            { competenceYear: { gt: prox.year } },
            { competenceYear: prox.year, competenceMonth: { gte: prox.month } },
          ],
        },
      })
    );
    expect(futuras).toBe(0);
  });
});

describe("regras do cadastro valem na edição direta", () => {
  it("modalidade TCV sem valor total/prazo é recusada; mensalidade em TCV é recusada", async () => {
    const c = await createMrrClient(owner, { name: "Inline Regras" });
    const r = await asOwner(owner, async () => acoes.setClientModality(c.id, "TCV"));
    expect(r.ok).toBe(false);
    await asOwner(owner, async () =>
      prisma.client.update({ where: { id: c.id }, data: { totalContractValue: 9000, contractMonths: 12 } })
    );
    expect((await asOwner(owner, async () => acoes.setClientModality(c.id, "TCV"))).ok).toBe(true);
    const lido = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { monthlyValue: true, paymentDay: true } })
    );
    expect(lido).toEqual({ monthlyValue: null, paymentDay: null });
    expect((await asOwner(owner, async () => acoes.setClientMonthlyValue(c.id, "500"))).ok).toBe(false);
  });

  it("CNPJ de outro cliente é recusado também na edição; tags viram minúsculas", async () => {
    const a = await asOwner(owner, async () =>
      acoes.saveClient(form({ name: "Empresa Doc A", status: "PROSPECT", document: "11.222.333/0001-81" }))
    );
    expect(a.ok, (a as any).error).toBe(true);
    const b = await asOwner(owner, async () =>
      acoes.saveClient(form({ name: "Empresa Doc B", status: "PROSPECT", tags: "VIP, Vip ,Indicação" }))
    );
    expect(b.ok, (b as any).error).toBe(true);
    const tags = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: (b as any).id }, select: { tags: true } })
    );
    expect(tags.tags.sort()).toEqual(["indicação", "vip"]);
    const edit = await asOwner(owner, async () =>
      acoes.saveClient(form({ id: (b as any).id, name: "Empresa Doc B", status: "PROSPECT", document: "11222333000181" }))
    );
    expect(edit.ok).toBe(false);
  });
});

describe("onboarding concluído promove a relação", () => {
  it("ONBOARDING → ACTIVE ao concluir", async () => {
    const id = await cadastrarMrr("Implantação Concluída");
    const rel = await relacao(id);
    await runWithoutScope(async () =>
      prisma.clientAgencyRelationship.update({ where: { id: rel.id }, data: { lifecycleStatus: "ONBOARDING" } })
    );
    const { concluirOnboarding } = await import("@/lib/services/onboarding");
    const r = await asOwner(owner, async () => concluirOnboarding(rel.id, { motivoExcecao: "teste" }));
    expect(r.ok).toBe(true);
    expect((await relacao(id)).lifecycleStatus).toBe("ACTIVE");
  });
});
