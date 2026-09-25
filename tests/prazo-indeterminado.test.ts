import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, asOwner, type TestOwner,
} from "./support/db";
import { currentYearMonth, fromMonthIndex, monthIndex, toCompetenceKey } from "@/lib/renewal-expectation";

/**
 * PRAZO INDETERMINADO (decisão do dono, 25/09/2026): cliente sem término,
 * ativo até ser dado como perdido. Não entra em Renovações sozinho — só
 * quando agendado à mão.
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
let clientes: typeof import("@/lib/actions/clients");
let renovacoes: typeof import("@/lib/actions/renewals");
let inline: typeof import("@/lib/actions/receivables-inline");
let ledger: typeof import("@/lib/services/renewal-schedule");
const HOJE = currentYearMonth();
const mes = (delta: number) => fromMonthIndex(monthIndex(HOJE) + delta);
const dd = (n: number) => String(n).padStart(2, "0");

beforeAll(async () => {
  owner = await createOwner();
  clientes = await import("@/lib/actions/clients");
  renovacoes = await import("@/lib/actions/renewals");
  inline = await import("@/lib/actions/receivables-inline");
  ledger = await import("@/lib/services/renewal-schedule");
});
afterAll(async () => {
  await destroyOwner(owner);
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Entrada há exatamente 12 meses: com prazo de 12, renovaria ESTE mês. */
async function cadastrar(nome: string, prazo: string, modelo: "MRR" | "TCV" = "MRR") {
  const entrada = mes(-12);
  return asOwner(owner, async () =>
    clientes.saveClient(form({
      name: nome, status: "ACTIVE", paymentModel: modelo,
      ...(modelo === "MRR" ? { monthlyValue: "1.000,00", paymentDay: "10" } : { totalContractValue: "6.000,00" }),
      contractMonths: prazo,
      startedAt: `05/${dd(entrada.month)}/${entrada.year}`,
    }))
  );
}

const ler = (id: string) =>
  runWithoutScope(async () => prisma.client.findUniqueOrThrow({ where: { id } }));

async function naLista(id: string, ym = HOJE): Promise<boolean> {
  const m = await asOwner(owner, async () => ledger.renewalLedgerMonth(ym));
  return m.rows.some((r) => r.clientId === id);
}

describe("prazo indeterminado", () => {
  it("cadastro MRR com Indeterminado: ativo, sem prazo, sem expectativa e fora de Renovações", async () => {
    const r = await cadastrar("Sem Termino", "indeterminado");
    expect(r.ok, (r as any).error).toBe(true);
    const id = (r as any).id as string;
    const c = await ler(id);
    expect(c.contractIndefinite).toBe(true);
    expect(c.contractMonths).toBeNull();
    expect(c.expectedRenewalAt).toBeNull();
    expect(c.status).toBe("ACTIVE");
    for (let d = 0; d <= 12; d++) expect(await naLista(id, mes(d))).toBe(false);
    // O contrato criado no cadastro não tem fim.
    const contrato = await runWithoutScope(async () => prisma.contract.findFirstOrThrow({ where: { clientId: id } }));
    expect(contrato.endDate).toBeNull();
  });

  it("o mesmo cliente com 12 meses entraria em Renovações neste mês (controle)", async () => {
    const r = await cadastrar("Com Prazo", "12");
    const id = (r as any).id as string;
    expect(await naLista(id)).toBe(true);
  });

  it("agendado à mão, aparece no mês agendado — e editar o cadastro não apaga o agendamento", async () => {
    const id = ((await cadastrar("Agendado Indeterminado", "indeterminado")) as any).id as string;
    const alvo = mes(2);
    const s = await asOwner(owner, async () => renovacoes.scheduleClientRenewal(id, toCompetenceKey(alvo)));
    expect(s.ok, (s as any).error).toBe(true);
    expect(await naLista(id, alvo)).toBe(true);

    const entrada = mes(-12);
    const ed = await asOwner(owner, async () =>
      clientes.saveClient(form({
        id, name: "Agendado Indeterminado", phone: "71999990000", status: "ACTIVE", paymentModel: "MRR",
        monthlyValue: "1.000,00", paymentDay: "10", contractMonths: "indeterminado",
        startedAt: `05/${dd(entrada.month)}/${entrada.year}`,
      }))
    );
    expect(ed.ok, (ed as any).error).toBe(true);
    expect(await naLista(id, alvo)).toBe(true);
    expect((await ler(id)).contractIndefinite).toBe(true);
  });

  it("trocar para Indeterminado na lista tira a expectativa e o fim do contrato; voltar a 12 recalcula", async () => {
    const id = ((await cadastrar("Troca Prazo", "12")) as any).id as string;
    expect(await naLista(id)).toBe(true);

    const r1 = await asOwner(owner, async () => inline.setClientContractMonths(id, "indeterminado"));
    expect(r1.ok, (r1 as any).error).toBe(true);
    let c = await ler(id);
    expect(c.contractIndefinite).toBe(true);
    expect(c.contractMonths).toBeNull();
    expect(c.expectedRenewalAt).toBeNull();
    expect(await naLista(id)).toBe(false);
    const vivos = await runWithoutScope(async () =>
      prisma.contract.findMany({ where: { clientId: id, status: "ACTIVE" }, select: { endDate: true, renewalDate: true } })
    );
    expect(vivos.length).toBeGreaterThan(0);
    for (const v of vivos) {
      expect(v.endDate).toBeNull();
      expect(v.renewalDate).toBeNull();
    }

    const r2 = await asOwner(owner, async () => inline.setClientContractMonths(id, 12));
    expect(r2.ok).toBe(true);
    c = await ler(id);
    expect(c.contractIndefinite).toBe(false);
    expect(c.contractMonths).toBe(12);
    expect(await naLista(id)).toBe(true);
  });

  it("TCV não aceita Indeterminado (cadastro e lista)", async () => {
    const r = await cadastrar("TCV Indeterminado", "indeterminado", "TCV");
    expect(r.ok).toBe(false);
    const ok = await cadastrar("TCV Com Prazo", "6", "TCV");
    const id = (ok as any).id as string;
    const r2 = await asOwner(owner, async () => inline.setClientContractMonths(id, "indeterminado"));
    expect(r2.ok).toBe(false);
    expect((await ler(id)).contractIndefinite).toBe(false);
  });

  it("renovar com prazo indeterminado: conta como ganha no mês e não gera nova expectativa", async () => {
    const id = ((await cadastrar("Renova Indeterminado", "12")) as any).id as string;
    const res = await asOwner(owner, async () =>
      renovacoes.renewClientFlow(form({
        clientId: id, months: "indeterminado", modality: "MRR",
        monthlyValue: "1.000,00", paymentDay: "10", launch: "0",
        forCompetence: toCompetenceKey(HOJE),
      }))
    );
    expect(res.ok, (res as any).error).toBe(true);
    const c = await ler(id);
    expect(c.contractIndefinite).toBe(true);
    expect(c.contractMonths).toBeNull();
    expect(c.expectedRenewalAt).toBeNull();
    expect(c.status).toBe("ACTIVE");
    const m = await asOwner(owner, async () => ledger.renewalLedgerMonth(HOJE));
    const linha = m.rows.find((r) => r.clientId === id);
    expect(linha?.outcome).toBe("renovou");
    expect(linha?.renewal?.months).toBeNull();
    for (let d = 1; d <= 13; d++) expect(await naLista(id, mes(d))).toBe(false);
  });

  it("TCV não renova com prazo indeterminado", async () => {
    const id = ((await cadastrar("TCV Renova", "6", "TCV")) as any).id as string;
    const res = await asOwner(owner, async () =>
      renovacoes.renewClientFlow(form({
        clientId: id, months: "indeterminado", modality: "TCV", totalValue: "6.000,00", launch: "0",
      }))
    );
    expect(res.ok).toBe(false);
  });
});
