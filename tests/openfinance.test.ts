import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, destroyOwner, prisma, type TestOwner,
} from "./support/db";
import { assinar } from "@/lib/integrations/avancecrm";
import { receberEventoDoOpenFinance } from "@/lib/integrations/openfinance";
import {
  conciliarAutomaticamente, linhasDaConta, registrarMovimentosDoBanco,
} from "@/lib/services/reconciliation";
import { runWithoutScope } from "@/lib/auth/owner-scope";

/**
 * F5.3 — Open Finance e conciliação automática.
 *
 * As duas regras que valem o módulo:
 *
 *  1. O AUTOMÁTICO SÓ DECIDE O ÓBVIO: um candidato, mesmo valor, até 3 dias.
 *     Dois candidatos iguais = humano — o automático que escolhe "o mais
 *     provável" concilia o errado e deixa a diferença apontando para o lugar
 *     errado no fim do mês.
 *  2. Reconexão de banco REENVIA a mesma janela de dias. O dedupe é do
 *     MOVIMENTO (mesmo hash da importação de arquivo), não do lote — e o
 *     mesmo evento reenviado nem chega a processar (S20).
 */

const SEGREDO = "segredo-openfinance-teste";
let segredoAntes: string | undefined;

async function entregar(evento: { id: string; type: string; data: Record<string, unknown> }) {
  const corpo = JSON.stringify(evento);
  return receberEventoDoOpenFinance(corpo, `sha256=${assinar(corpo, SEGREDO)}`);
}

describe("F5.3 — conciliação automática e Open Finance", () => {
  let dono: TestOwner;
  let donoAnteriorDoWorkspace: string | null = null;
  let contaId: string;

  beforeAll(async () => {
    dono = await createOwner();
    segredoAntes = process.env.OPENFINANCE_WEBHOOK_SECRET;
    process.env.OPENFINANCE_WEBHOOK_SECRET = SEGREDO;
    await runWithoutScope(async () => {
      const ws = await prisma.workspace.findFirstOrThrow({ select: { id: true, ownerId: true } });
      donoAnteriorDoWorkspace = ws.ownerId;
      await prisma.workspace.update({ where: { id: ws.id }, data: { ownerId: dono.id } });
    });
    contaId = await asOwner(dono, async () =>
      (
        await prisma.account.create({
          data: { name: "Conta Open Finance", type: "corrente", balance: 0 },
          select: { id: true },
        })
      ).id
    );
  });

  afterEach(async () => {
    await asOwner(dono, async () => {
      await prisma.reconciliationMatch.deleteMany({});
      await prisma.bankStatementEntry.deleteMany({ where: { accountId: contaId } });
      await prisma.bankStatement.deleteMany({ where: { accountId: contaId } });
      await prisma.transaction.deleteMany({});
    });
  });

  afterAll(async () => {
    if (segredoAntes === undefined) delete process.env.OPENFINANCE_WEBHOOK_SECRET;
    else process.env.OPENFINANCE_WEBHOOK_SECRET = segredoAntes;
    await runWithoutScope(async () => {
      await prisma.webhookInbox.deleteMany({ where: { source: "openfinance" } });
      const ws = await prisma.workspace.findFirstOrThrow({ select: { id: true } });
      await prisma.workspace.update({
        where: { id: ws.id },
        data: { ownerId: donoAnteriorDoWorkspace },
      });
    });
    await destroyOwner(dono);
  });

  async function despesa(valor: number, dia: number, descricao: string) {
    return asOwner(dono, async () =>
      prisma.transaction.create({
        data: {
          date: new Date(2027, 5, dia),
          description: descricao,
          amount: valor,
          type: "despesa",
          status: "pago",
        },
        select: { id: true },
      })
    );
  }

  it("resolve sozinha o óbvio — e escreve o motivo do que deixou", async () => {
    await asOwner(dono, async () => {
      await despesa(300, 10, "Software de tráfego");
      // Ambígua de propósito: DUAS despesas de 90 no mesmo dia.
      await despesa(90, 12, "Taxa bancária");
      await despesa(90, 12, "Tarifa de manutenção");

      const r1 = await registrarMovimentosDoBanco(contaId, [
        { externalId: "of-1", postedAt: new Date(2027, 5, 10), amount: -300, description: "PAG SOFTWARE", balanceAfter: null },
        { externalId: "of-2", postedAt: new Date(2027, 5, 12), amount: -90, description: "TARIFA", balanceAfter: null },
        { externalId: "of-3", postedAt: new Date(2027, 5, 20), amount: -55.5, description: "DESCONHECIDO", balanceAfter: null },
      ]);
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;
      expect(r1.importadas).toBe(3);
      expect(r1.conciliadas).toBe(1); // só a de 300 — a única óbvia

      const linhas = await linhasDaConta(contaId, "2027-06");
      const de300 = linhas.find((l) => l.amount === -300)!;
      expect(de300.state).toBe("MATCHED");
      expect(de300.matches).toHaveLength(1);

      // A ambígua e a sem par continuam SEM match, à vista.
      expect(linhas.find((l) => l.amount === -90)!.state).toBe("UNMATCHED");
      expect(linhas.find((l) => l.amount === -55.5)!.state).toBe("UNMATCHED");

      const r2 = await conciliarAutomaticamente(contaId, "2027-06");
      const motivos = r2.deixadas.map((d) => d.motivo).join(" | ");
      expect(motivos).toMatch(/escolha humana/i);
      expect(motivos).toMatch(/Nenhum lançamento parecido/i);
    });
  });

  it("rodar duas vezes não duplica nada — o match fica onde está", async () => {
    await asOwner(dono, async () => {
      await despesa(120, 5, "Assinatura");
      await registrarMovimentosDoBanco(contaId, [
        { externalId: "of-b1", postedAt: new Date(2027, 5, 5), amount: -120, description: "ASSIN", balanceAfter: null },
      ]);
      const r = await conciliarAutomaticamente(contaId, "2027-06");
      expect(r.examinadas).toBe(0);
      const matches = await prisma.reconciliationMatch.count({});
      expect(matches).toBe(1);
    });
  });

  it("o webhook grava, deduplica pelo movimento e reprocessa com segurança (S20)", async () => {
    const alvo = await despesa(777, 15, "Mídia paga");
    const evento = {
      id: "of-evt-1",
      type: "banking.transactions",
      data: {
        accountId: contaId,
        transactions: [
          { id: "tx-a", postedAt: "2027-06-15T12:00:00.000Z", amount: -777, description: "FB ADS" },
          { id: "tx-quebrada", postedAt: "sem-data", amount: 10, description: "ilegível" },
          { id: "tx-zero", postedAt: "2027-06-16T12:00:00.000Z", amount: 0, description: "zerada" },
        ],
      },
    };

    const um = await entregar(evento);
    expect(um.ok && um.situacao).toBe("PROCESSADO");
    if (um.ok) expect(um.nota).toMatch(/1 movimento\(s\) novo/);

    // O MESMO evento de novo: nem processa (caixa de entrada).
    const dois = await entregar(evento);
    expect(dois.ok && dois.situacao).toBe("REPETIDO");

    // OUTRO evento com a MESMA janela (reconexão): o hash segura.
    const tres = await entregar({ ...evento, id: "of-evt-2" });
    expect(tres.ok && tres.situacao).toBe("PROCESSADO");
    if (tres.ok) expect(tres.nota).toMatch(/0 movimento\(s\) novo/);

    await asOwner(dono, async () => {
      const linhas = await linhasDaConta(contaId, "2027-06");
      expect(linhas).toHaveLength(1); // ilegível e zerada NUNCA viram linha
      expect(linhas[0].state).toBe("MATCHED"); // conciliada sozinha com a despesa
      expect(linhas[0].matches[0].targetId).toBe(alvo.id);
    });
  });

  it("assinatura errada morre na porta; conta desconhecida fica guardada como ignorada", async () => {
    const corpo = JSON.stringify({ id: "of-x", type: "banking.transactions", data: {} });
    const errada = await receberEventoDoOpenFinance(corpo, "sha256=" + "0".repeat(64));
    expect(errada.ok).toBe(false);
    if (!errada.ok) expect(errada.status).toBe(401);

    const semConta = await entregar({
      id: "of-evt-3",
      type: "banking.transactions",
      data: { accountId: "nao-existe", transactions: [{ id: "t", postedAt: "2027-06-01", amount: 5, description: "x" }] },
    });
    expect(semConta.ok && semConta.situacao).toBe("IGNORADO");
  });
});
