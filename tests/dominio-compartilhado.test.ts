import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling, asOwner,
  type TestOwner,
} from "./support/db";
import type { DomainContext } from "@/lib/engines/domain";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * CAMADA DE DOMÍNIO COMPARTILHADA (27/09/2026 — preparação da API).
 *
 * A interface (Server Action) e a futura API chamam as MESMAS funções com um
 * DomainContext (dono obrigatório + principal). Aqui:
 *  · a guarda de permissão dos motores falha FECHADA dentro de requisição
 *    sem sessão (antes: o redirect era engolido e virava OK);
 *  · o principal declarado vale sem cookie (getCurrentUser, guarda, auditoria);
 *  · cada função extraída faz o que a action fazia, no escopo do dono.
 */

// Modo da "sessão" simulada: sem cookie dentro de requisição = redirect.
let sessao: "admin" | "sem-sessao-em-request" | "fora-de-request" = "admin";
vi.mock("@/lib/auth/viewer", () => {
  const admin = { id: "sessao", name: "Sessão", email: "sessao@b2c.local", role: "ADMIN", permissions: [], workspaceOwnerId: null, personId: null };
  const redirect = () => {
    const e: any = new Error("NEXT_REDIRECT");
    e.digest = "NEXT_REDIRECT;replace;/api/auth/encerrar;307;";
    throw e;
  };
  const viewer = async () => {
    if (sessao === "sem-sessao-em-request") return redirect();
    if (sessao === "fora-de-request") throw new Error("cookies() fora de requisição");
    return admin;
  };
  return {
    getViewer: viewer,
    requirePermission: viewer,
    tryPermission: viewer,
    NO_PERMISSION: { ok: false, error: "Sem permissão." },
    can: () => true,
  };
});
vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {}, revalidateFinance: () => {}, revalidateClients: () => {},
  revalidateCatalog: () => {}, revalidateClientStatus: () => {},
}));
vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

let owner: TestOwner;
let outro: TestOwner;

const usuario = (role: string, permissions: string[] = []): Principal => ({
  kind: "user",
  origin: "API",
  user: {
    id: `u-${role}`, name: role, email: `${role.toLowerCase()}@b2c.local`, role,
    permissions: permissions.map((permission) => ({ permission, enabled: true })),
    workspaceOwnerId: null,
  },
});
const ctxDe = (o: TestOwner, principal: Principal = usuario("ADMIN")): DomainContext => ({
  ownerId: o.id,
  principal,
});

beforeAll(async () => {
  owner = await createOwner();
  outro = await createOwner();
});
afterAll(async () => {
  await destroyOwner(owner);
  await destroyOwner(outro);
});

describe("guarda de permissão dos motores", () => {
  it("dentro de requisição SEM sessão e sem principal: NEGA (antes passava)", async () => {
    const { guardPermission } = await import("@/lib/engines/guards");
    sessao = "sem-sessao-em-request";
    try {
      expect((await guardPermission("recebimentos.registrar_pagamento")).ok).toBe(false);
    } finally {
      sessao = "admin";
    }
  });

  it("fora de requisição (job/script) segue OK, como antes", async () => {
    const { guardPermission } = await import("@/lib/engines/guards");
    sessao = "fora-de-request";
    try {
      expect((await guardPermission("recebimentos.registrar_pagamento")).ok).toBe(true);
    } finally {
      sessao = "admin";
    }
  });

  it("principal declarado: sistema passa; usuário passa pelo RBAC real", async () => {
    const { guardPermission } = await import("@/lib/engines/guards");
    const { runWithPrincipal, systemPrincipal } = await import("@/lib/auth/owner-scope");
    sessao = "sem-sessao-em-request"; // prova que o cookie não é consultado
    try {
      expect(
        (await runWithPrincipal(owner.id, systemPrincipal("teste"), () => guardPermission("recebimentos.registrar_pagamento"))).ok
      ).toBe(true);
      expect(
        (await runWithPrincipal(owner.id, usuario("LEITURA"), () => guardPermission("recebimentos.registrar_pagamento"))).ok
      ).toBe(false);
      expect(
        (await runWithPrincipal(owner.id, usuario("LEITURA", ["recebimentos.registrar_pagamento"]), () =>
          guardPermission("recebimentos.registrar_pagamento"))).ok
      ).toBe(true);
    } finally {
      sessao = "admin";
    }
  });
});

describe("contexto de domínio", () => {
  it("dono é obrigatório", async () => {
    const { inDomain } = await import("@/lib/engines/domain");
    await expect(inDomain({ ownerId: "", principal: usuario("ADMIN") }, async () => 1)).rejects.toThrow(/dono/);
  });

  it("auditoria segue o principal, sem cookie", async () => {
    const { runWithPrincipal, systemPrincipal } = await import("@/lib/auth/owner-scope");
    const { contextFromRequest } = await import("@/lib/engines/context");
    const p = usuario("GESTOR");
    // (getCurrentUser usa cache() do React, que só existe no runtime do Next;
    //  a mesma regra é coberta pela guarda e pela auditoria abaixo.)
    const sys = await runWithPrincipal(owner.id, systemPrincipal("webhook-gateway", "API"), () => contextFromRequest());
    expect(sys).toMatchObject({ actorId: null, actorEmail: "sistema:webhook-gateway", origin: "API" });
    const api = await runWithPrincipal(owner.id, p, () => contextFromRequest());
    expect(api).toMatchObject({ actorId: "u-GESTOR", origin: "API" });
  });
});

describe("funções de domínio extraídas", () => {
  it("salvarCliente: mesmo resultado que a action (cliente, contrato e cobranças MRR)", async () => {
    const { salvarCliente } = await import("@/lib/services/client-service");
    const acoes = await import("@/lib/actions/clients");
    const campos = {
      status: "ACTIVE", paymentModel: "MRR", monthlyValue: "1.200,00", paymentDay: "10",
      contractMonths: "12", startedAt: "01/03/2026",
    };
    const fd = new FormData();
    for (const [k, v] of Object.entries({ name: "Pela Action", ...campos })) fd.set(k, v);
    const viaAction = await asOwner(owner, async () => acoes.saveClient(fd));
    const viaDominio = await salvarCliente(ctxDe(owner), {
      name: "Pelo Domínio", legalName: null, document: null, email: null, phone: null, nicheId: null,
      city: null, state: null, address: null, legalRepresentative: null, origin: null, salesOwnerId: null,
      opsOwner: null, paymentDay: 10, tags: [], status: "ACTIVE", modality: "MRR", monthlyValue: 1200,
      totalContractValue: null, contractMonths: 12, contractIndefinite: false,
      startedAt: new Date(2026, 2, 1), notes: null,
    });
    expect(viaAction.ok && viaDominio.ok).toBe(true);
    const ler = (id: string) =>
      runWithoutScope(async () =>
        prisma.client.findUniqueOrThrow({
          where: { id },
          select: {
            status: true, modality: true, monthlyValue: true, paymentDay: true, contractMonths: true,
            expectedRenewalAt: true, ownerId: true,
            contracts: { select: { type: true, totalValue: true } },
            _count: { select: { billings: true } },
          },
        })
      );
    const a = await ler((viaAction as any).id);
    const d = await ler((viaDominio as any).id);
    expect(d).toEqual(a);
    expect(d.ownerId).toBe(owner.id);
  });

  it("salvarCliente respeita o dono: editar cliente de outro dono = não encontrado", async () => {
    const { salvarCliente } = await import("@/lib/services/client-service");
    const alheio = await createMrrClient(outro, { name: "De Outro Dono" });
    const r = await salvarCliente(ctxDe(owner), {
      id: alheio.id, name: "Invasão", legalName: null, document: null, email: null, phone: null, nicheId: null,
      city: null, state: null, address: null, legalRepresentative: null, origin: null, salesOwnerId: null,
      opsOwner: null, paymentDay: 10, tags: [], status: "ACTIVE", modality: "MRR", monthlyValue: 1,
      totalContractValue: null, contractMonths: null, contractIndefinite: false, startedAt: null, notes: null,
    });
    expect(r).toMatchObject({ ok: false, error: "Cliente não encontrado." });
  });

  it("registerPayment: RBAC do principal vale; com permissão registra; saldo em aberto quita", async () => {
    const { registerPayment, settleOpenBalance } = await import("@/lib/engines/payment-engine");
    const c = await createMrrClient(owner, { monthlyValue: 1000 });
    const b1 = await createBilling(owner, c.id, { year: 2026, month: 6, amount: 1000 });
    const b2 = await createBilling(owner, c.id, { year: 2026, month: 7, amount: 800 });
    const pedido = {
      billingId: b1.id, amount: 400, paidAt: new Date(Date.UTC(2026, 5, 12)), method: "PIX" as const,
      accountId: null, notes: null,
    };
    const semPermissao = await registerPayment(ctxDe(owner, usuario("LEITURA")), pedido);
    expect(semPermissao.ok).toBe(false);
    const ok = await registerPayment(ctxDe(owner, usuario("FINANCEIRO")), pedido);
    expect(ok.ok, (ok as any).error).toBe(true);
    const quita = await settleOpenBalance(ctxDe(owner), b2.id);
    expect(quita.ok, (quita as any).error).toBe(true);
    const lido = await runWithoutScope(async () => prisma.billing.findUniqueOrThrow({ where: { id: b2.id } }));
    expect(lido.status).toBe("PAID");
  });

  it("registrarContato/NotaDeCobranca: histórico e estado de cobrança", async () => {
    const { registrarContatoDeCobranca, registrarNotaDeCobranca } = await import("@/lib/services/billing-collection");
    const c = await createMrrClient(owner);
    const b = await createBilling(owner, c.id, { year: 2026, month: 5, amount: 500 });
    expect((await registrarContatoDeCobranca(ctxDe(owner), { billingId: b.id, channel: "whatsapp", excerpt: "Olá" })).ok).toBe(true);
    const r = await registrarNotaDeCobranca(ctxDe(owner), {
      billingId: b.id, status: "PROMISED", channel: "telefone", message: "Paga sexta", nextActionAt: null,
    });
    expect(r).toMatchObject({ ok: true, clientId: c.id });
    const hist = await runWithoutScope(async () => prisma.collectionHistory.findMany({ where: { billingId: b.id } }));
    expect(hist).toHaveLength(2);
    const lido = await runWithoutScope(async () => prisma.billing.findUniqueOrThrow({ where: { id: b.id } }));
    expect(lido.collectionStatus).toBe("PROMISED");
  });

  it("salvarDespesa: recorrência mensal materializa 12 meses no mesmo grupo", async () => {
    const { salvarDespesa } = await import("@/lib/services/expense-service");
    const r = await salvarDespesa(ctxDe(owner), {
      description: "Aluguel domínio", notes: null, amount: 2000, dueDate: new Date(2026, 0, 5),
      recurrence: "MONTHLY", recurrenceInterval: null, status: "pendente", expenseType: "FIXED",
      categoryId: null, cardId: null, cardInvoiceMonth: null, cardInvoiceYear: null,
    });
    expect(r.ok).toBe(true);
    const todas = await runWithoutScope(async () =>
      prisma.transaction.findMany({ where: { ownerId: owner.id, description: "Aluguel domínio" } })
    );
    expect(todas).toHaveLength(13);
    expect(new Set(todas.map((t) => t.recurrenceGroupId)).size).toBe(1);
  });

  it("upsell: vendido lança a cobrança; excluir cancela a cobrança sem pagamento", async () => {
    const { alterarStatusDoUpsell, excluirUpsell } = await import("@/lib/services/upsell-service");
    const c = await createMrrClient(owner, { name: "Upsell Domínio" });
    const up = await asOwner(owner, async () =>
      prisma.upsell.create({ data: { clientId: c.id, title: "Tráfego", value: 900, status: "NEGOTIATION" }, select: { id: true } })
    );
    const r = await alterarStatusDoUpsell(ctxDe(owner), { id: up.id, status: "WON", launchBilling: true, month: 8, year: 2026 });
    expect(r.ok, (r as any).error).toBe(true);
    const billingId = (r as any).id as string;
    const cob = await runWithoutScope(async () => prisma.billing.findUniqueOrThrow({ where: { id: billingId } }));
    expect(cob).toMatchObject({ revenueType: "ONE_TIME", competenceMonth: 8, competenceYear: 2026 });
    expect(Number(cob.amount)).toBe(900);
    expect((await excluirUpsell(ctxDe(owner), up.id)).ok).toBe(true);
    const depois = await runWithoutScope(async () => prisma.billing.findUniqueOrThrow({ where: { id: billingId } }));
    expect(depois.status).toBe("CANCELED");
  });

  it("rotina do dia: o recorte segue o RBAC do principal", async () => {
    const { montarRotinaDoDia } = await import("@/lib/services/daily-routine");
    const tudo = await montarRotinaDoDia(ctxDe(owner));
    expect(Array.isArray(tudo.acoes)).toBe(true);
    const leitura = await montarRotinaDoDia(ctxDe(owner, usuario("LEITURA")));
    expect(leitura.queue).toEqual([]);
    expect(leitura.cash).toBeNull();
  });

  it("relatórios: mesma regra de acesso da tela (folha exige permissão própria)", async () => {
    const { acessoAoRelatorio, executarRelatorio } = await import("@/lib/reports/run");
    expect(acessoAoRelatorio(ctxDe(owner), "nao-existe")).toMatchObject({ ok: false, code: "NAO_ENCONTRADO" });
    const leitura = acessoAoRelatorio(ctxDe(owner, usuario("LEITURA", ["relatorios.visualizar"])), "folha");
    expect(leitura).toMatchObject({ ok: false, code: "SEM_PERMISSAO" });
    const admin = acessoAoRelatorio(ctxDe(owner), "clientes");
    expect(admin.ok).toBe(true);
    if (admin.ok) {
      const { parseReportQuery } = await import("@/lib/reports/query");
      const linhas = await executarRelatorio(ctxDe(owner), admin.def, parseReportQuery({}));
      expect(Array.isArray(linhas)).toBe(true);
    }
  });

  it("salvarContrato: TCV é valor cheio sem recorrência; MRR deriva a mensalidade pelo prazo", async () => {
    const { salvarContrato, encerrarContrato, cancelarContrato } = await import("@/lib/services/contract-service");
    const c = await createMrrClient(owner, { name: "Contratos Domínio" });
    const base = {
      clientId: c.id, status: "ACTIVE" as const, setupFee: null, renewalDate: null,
      billingDay: 5, autoRenew: false, notes: null, services: [],
    };
    const tcv = await salvarContrato(ctxDe(owner), {
      ...base, title: "TCV", type: "TCV", recurrence: "MONTHLY", monthlyValue: 500, totalValue: 6000,
      startDate: new Date(2026, 0, 1), endDate: null,
    });
    const mrr = await salvarContrato(ctxDe(owner), {
      ...base, title: "MRR", type: "MRR", recurrence: "MONTHLY", monthlyValue: 0, totalValue: 5100,
      startDate: new Date(2026, 0, 1), endDate: new Date(2026, 2, 31),
    });
    expect(tcv.ok && mrr.ok).toBe(true);
    const ler = (id: string) => runWithoutScope(async () => prisma.contract.findUniqueOrThrow({ where: { id } }));
    const t = await ler((tcv as any).id);
    expect(t.recurrence).toBe("NONE");
    expect(Number(t.monthlyValue)).toBe(0);
    const m = await ler((mrr as any).id);
    expect(Number(m.monthlyValue)).toBe(1700);
    expect((await encerrarContrato(ctxDe(owner), t.id)).ok).toBe(true);
    expect((await ler(t.id)).status).toBe("ENDED");
    expect((await cancelarContrato(ctxDe(owner), m.id)).ok).toBe(true);
    expect((await ler(m.id)).status).toBe("CANCELED");
    // Cliente de outro dono: recusado.
    const alheio = await createMrrClient(outro, { name: "Contrato Alheio" });
    const r = await salvarContrato(ctxDe(owner), {
      ...base, clientId: alheio.id, title: "X", type: "MRR", recurrence: "MONTHLY", monthlyValue: 1,
      totalValue: 0, startDate: new Date(2026, 0, 1), endDate: null,
    });
    expect(r).toMatchObject({ ok: false, error: "Cliente não encontrado." });
  });

  it("renovarCliente: renova pelo domínio; sem permissão de pagamento, lança e avisa", async () => {
    const { renovarCliente } = await import("@/lib/engines/renewal-engine");
    const c = await createMrrClient(owner, { name: "Renova Domínio", monthlyValue: 1000 });
    const r = await renovarCliente(ctxDe(owner, usuario("COMERCIAL", ["contratos.editar"])), {
      clientId: c.id, months: "12", modality: "MRR", monthlyValue: "1.300,00", paymentDay: "10",
      launch: "1", payStatus: "total", competence: "2026-09",
    });
    expect(r.ok, (r as any).error).toBe(true);
    expect((r as any).warning).toMatch(/sem permissão para registrar o pagamento/);
    const cli = await runWithoutScope(async () => prisma.client.findUniqueOrThrow({ where: { id: c.id } }));
    expect(Number(cli.monthlyValue)).toBe(1300);
    expect(cli.contractMonths).toBe(12);
    const hist = await runWithoutScope(async () => prisma.clientRenewal.findMany({ where: { clientId: c.id } }));
    expect(hist).toHaveLength(1);
    expect(hist[0].createdBy).toBe("comercial@b2c.local");
  });
});

describe("recorte, dono e eventos", () => {
  it("escopoAtual segue o principal: usuário restrito à agência continua restrito sem cookie", async () => {
    const { escopoAtual } = await import("@/lib/services/data-scope");
    const { runWithPrincipal, systemPrincipal } = await import("@/lib/auth/owner-scope");
    const agencia = await runWithoutScope(async () =>
      prisma.agency.findFirstOrThrow({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } })
    );
    const membro = await runWithoutScope(async () =>
      prisma.user.create({
        data: {
          name: "Membro agência", email: `membro-${owner.id}@b2c.local`, passwordHash: "x", role: "COMERCIAL",
          workspaceOwnerId: owner.id, dataScope: "AGENCY", scopeAgencyId: agencia.id,
        },
        select: { id: true, email: true },
      })
    );
    try {
      const p: Principal = {
        kind: "user", origin: "API",
        user: { id: membro.id, name: "Membro", email: membro.email, role: "COMERCIAL", permissions: [], workspaceOwnerId: owner.id },
      };
      expect(await runWithPrincipal(owner.id, p, () => escopoAtual())).toEqual({ kind: "AGENCY", agencyId: agencia.id });
      expect(await runWithPrincipal(owner.id, systemPrincipal("job"), () => escopoAtual())).toEqual({ kind: "WORKSPACE" });
    } finally {
      await runWithoutScope(async () => prisma.user.delete({ where: { id: membro.id } }));
    }
  });

  it("exigirDoDono: id de outro dono = não encontrado", async () => {
    const { exigirDoDono } = await import("@/lib/engines/domain");
    const meu = await createMrrClient(owner, { name: "Meu" });
    const alheio = await createMrrClient(outro, { name: "Alheio" });
    await expect(exigirDoDono(ctxDe(owner), "client", meu.id, "Cliente")).resolves.toBeUndefined();
    await expect(exigirDoDono(ctxDe(owner), "client", alheio.id, "Cliente")).rejects.toThrow("Cliente não encontrado.");
  });

  it("despesa paga publica no canal de integração — nunca no canal do gateway", async () => {
    const { setExpenseStatus } = await import("@/lib/engines/expense-engine");
    const { runWithPrincipal } = await import("@/lib/auth/owner-scope");
    const d = await asOwner(owner, async () =>
      prisma.transaction.create({
        data: { description: "Despesa evento", amount: 100, type: "despesa", status: "pendente", date: new Date(), dueDate: new Date(), belongsTo: "empresa" },
        select: { id: true },
      })
    );
    const r = await runWithPrincipal(owner.id, usuario("ADMIN"), () => setExpenseStatus(d.id, "pago"));
    expect(r.ok, (r as any).error).toBe(true);
    const ev = await runWithoutScope(async () =>
      prisma.outboxEvent.findFirst({ where: { eventType: "despesa.paga", sourceId: d.id } })
    );
    expect(ev?.channel).toBe("integracao");
  });
});
