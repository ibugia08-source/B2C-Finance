import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  asOwner, createOwner, destroyOwner, createMrrClient, createBilling,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { limparSistema, ESTRUTURA } from "@/lib/services/limpar-sistema";

/**
 * Limpeza total do sistema (botão de Configurações + scripts/inicio-limpo).
 * A regra que importa: TODO o movimento sai, NADA da estrutura sai — e a
 * conferência é nos dois sentidos.
 */

let dono: TestOwner;
beforeAll(async () => { dono = await createOwner(); });
afterAll(async () => { await destroyOwner(dono); });

describe("limparSistema", () => {
  it("zera o movimento, preserva estrutura e deixa o marco zero na auditoria", async () => {
    // Movimento de verdade antes da limpeza.
    const cliente = await createMrrClient(dono, { name: "Cliente Que Some" });
    await createBilling(dono, cliente.id, { month: 6, year: 2026, amount: 500 });

    const contasAntes = await runWithoutScope(async () =>
      prisma.accountingAccount.count()
    );
    const usuariosAntes = await runWithoutScope(async () => prisma.user.count());
    expect(contasAntes).toBeGreaterThan(0);

    const r = await asOwner(dono, async () =>
      limparSistema({ actorEmail: dono.email })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registrosApagados).toBeGreaterThan(0);

    // Movimento: zero.
    const [clientes, cobrancas, pagamentos, fotos] = await runWithoutScope(async () =>
      Promise.all([
        prisma.client.count(),
        prisma.billing.count(),
        prisma.payment.count(),
        prisma.snapshot.count(),
      ])
    );
    expect(clientes).toBe(0);
    expect(cobrancas).toBe(0);
    expect(pagamentos).toBe(0);
    expect(fotos).toBe(0);

    // Estrutura: intacta — inclusive quem estava logado.
    const [contasDepois, usuariosDepois, workspace, agencia] = await runWithoutScope(
      async () =>
        Promise.all([
          prisma.accountingAccount.count(),
          prisma.user.count(),
          prisma.workspace.count(),
          prisma.agency.count(),
        ])
    );
    expect(contasDepois).toBe(contasAntes);
    expect(usuariosDepois).toBe(usuariosAntes);
    expect(workspace).toBe(1);
    expect(agencia).toBeGreaterThan(0);

    // Marco zero: a primeira linha da nova auditoria diz QUEM limpou.
    const marco = await runWithoutScope(async () =>
      prisma.auditLog.findFirst({ orderBy: { createdAt: "asc" } })
    );
    expect(marco?.entity).toBe("Sistema");
    expect(marco?.actorEmail).toBe(dono.email);
  });

  it("a lista de estrutura cobre as tabelas de que o login e o motor dependem", () => {
    for (const essencial of ["User", "Workspace", "Agency", "AccountingAccount", "MetricDefinition", "PostingRule", "FeatureFlag"]) {
      expect(ESTRUTURA.has(essencial)).toBe(true);
    }
    // E NUNCA pode conter tabela de movimento — o dia em que alguém adicionar
    // "Client" aqui, este teste explica o porquê de não poder.
    for (const movimento of ["Client", "Billing", "Payment", "Snapshot", "Transaction"]) {
      expect(ESTRUTURA.has(movimento)).toBe(false);
    }
  });
});
