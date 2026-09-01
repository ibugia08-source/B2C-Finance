import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import { despacharPelaRegua, filaDeCobranca } from "@/lib/services/collection-tasks";

/**
 * F5.1 — envio em 1 clique + teto de frequência (decisão 19.17).
 *
 * A decisão da direção, ao pé da letra: "não automatize por completo o envio
 * da mensagem, apenas deixe isso pronto e aprovado" — em D-3, no vencimento e
 * quando estiver devendo. O que estes testes provam:
 *
 *  1. NUNCA duas mensagens para o mesmo cliente no mesmo dia. Quem deve três
 *     faturas é UMA pessoa no WhatsApp.
 *  2. O clique humano registra a etapa E publica o pedido de envio na MESMA
 *     transação — e a trava do banco impede a mensagem dupla.
 *  3. Sem provedor configurado, o serviço RECUSA em vez de marcar como
 *     enviada uma mensagem que ninguém recebeu.
 */

// Quinta-feira, como nos testes da F3.9 — nada aqui cai em fim de semana.
const QUINTA = new Date(2027, 3, 15);

const ENV = ["AVANCECRM_WEBHOOK_URL", "AVANCECRM_WEBHOOK_SECRET"] as const;
const antes: Record<string, string | undefined> = {};

function ligarIntegracao() {
  process.env.AVANCECRM_WEBHOOK_URL = "https://exemplo.avancecrm.test/entrada";
  process.env.AVANCECRM_WEBHOOK_SECRET = "segredo-de-teste";
}
function desligarIntegracao() {
  delete process.env.AVANCECRM_WEBHOOK_URL;
  delete process.env.AVANCECRM_WEBHOOK_SECRET;
}

describe("F5.1 — teto de frequência e despacho pela régua", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
    for (const k of ENV) antes[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  async function clienteComDuasDividas(telefone = "71 99999-0000") {
    const c = await createMrrClient(dono, { name: `Devedor ${Math.random().toString(36).slice(2, 8)}` });
    await asOwner(dono, () =>
      prisma.client.update({ where: { id: c.id }, data: { phone: telefone } })
    );
    // Competências DIFERENTES (a unique de Billing exige), vencidas há 7 e 37
    // dias contando de QUINTA (15/04/2027): ambas têm degrau pendente.
    const b1 = await createBilling(dono, c.id, {
      month: 4, year: 2027, amount: 900, dueDate: new Date(2027, 3, 8),
    });
    const b2 = await createBilling(dono, c.id, {
      month: 3, year: 2027, amount: 1500, dueDate: new Date(2027, 2, 9),
    });
    return { c, recente: b1, antiga: b2 };
  }

  it("duas dívidas do mesmo cliente = UMA tarefa; a outra aparece calada com o motivo", async () => {
    await asOwner(dono, async () => {
      const { antiga } = await clienteComDuasDividas();
      const fila = await filaDeCobranca(QUINTA);

      expect(fila.tarefas).toHaveLength(1);
      // A que fica é a MAIS atrasada — a ordenação da fila decide.
      expect(fila.tarefas[0].billingId).toBe(antiga.id);

      const caladas = fila.suprimidas.filter((s) => s.motivo === "FREQUENCIA");
      expect(caladas).toHaveLength(1);
      expect(caladas[0].explicacao).toMatch(/uma por dia/i);
    });
  });

  it("cliente que JÁ recebeu mensagem hoje não recebe outra — nem por outra cobrança", async () => {
    await asOwner(dono, async () => {
      const { c, antiga } = await clienteComDuasDividas();
      // A mensagem da manhã, registrada como etapa da régua.
      await prisma.collectionHistory.create({
        data: {
          billingId: antiga.id, clientId: c.id, status: "CONTACTED",
          reguaStep: "D+15", contactedAt: new Date(2027, 3, 15, 9, 0),
        },
      });
      const fila = await filaDeCobranca(QUINTA);
      const doCliente = fila.tarefas.filter((t) => t.clientId === c.id);
      expect(doCliente).toHaveLength(0);
      // ... e a razão está À VISTA, não escondida.
      expect(
        fila.suprimidas.some((s) => s.clientId === c.id && s.motivo === "FREQUENCIA")
      ).toBe(true);
    });
  });

  it("sem provedor configurado, o despacho RECUSA — e não marca nada como enviado", async () => {
    await asOwner(dono, async () => {
      desligarIntegracao();
      const { recente } = await clienteComDuasDividas();
      const r = await despacharPelaRegua(recente.id, "D+7", "Olá! Sua fatura está em aberto.");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/envio pelo sistema/i);
      expect(
        await prisma.collectionHistory.count({ where: { billingId: recente.id } })
      ).toBe(0);
    });
  });

  it("o clique registra a etapa E publica o pedido de envio — juntos, uma vez só", async () => {
    await asOwner(dono, async () => {
      ligarIntegracao();
      const { recente, c } = await clienteComDuasDividas();

      const um = await despacharPelaRegua(recente.id, "D+7", "Olá! Sua fatura está em aberto.");
      expect(um.ok).toBe(true);

      // O segundo clique bate na trava do banco e recebe resposta limpa.
      const dois = await despacharPelaRegua(recente.id, "D+7", "Olá! Sua fatura está em aberto.");
      expect(dois.ok).toBe(false);
      if (!dois.ok) expect(dois.error).toMatch(/já foi enviada/i);

      const historico = await prisma.collectionHistory.findMany({
        where: { billingId: recente.id },
      });
      expect(historico).toHaveLength(1);
      expect(historico[0].reguaStep).toBe("D+7");
      expect(historico[0].channel).toBe("whatsapp");

      const eventos = await prisma.outboxEvent.findMany({
        where: { sourceId: recente.id, eventType: "COLLECTION_MESSAGE_REQUESTED" },
      });
      expect(eventos).toHaveLength(1);
      expect(eventos[0].channel).toBe("whatsapp");
      const payload = eventos[0].payload as any;
      expect(payload.telefone).toContain("99999");
      expect(payload.clientId).toBe(c.id);
      expect(payload.mensagem).toContain("fatura");
    });
  });

  it("cliente sem telefone e cliente em opt-out não recebem despacho", async () => {
    await asOwner(dono, async () => {
      ligarIntegracao();

      const sem = await clienteComDuasDividas("");
      const r1 = await despacharPelaRegua(sem.recente.id, "D+7", "Olá!");
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.error).toMatch(/telefone/i);

      const opt = await clienteComDuasDividas();
      await prisma.client.update({
        where: { id: opt.c.id },
        data: { collectionOptOut: true },
      });
      const r2 = await despacharPelaRegua(opt.recente.id, "D+7", "Olá!");
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.error).toMatch(/não receber/i);
    });
  });
});
