import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import { assinar } from "@/lib/integrations/avancecrm";
import { receberEventoDoGateway } from "@/lib/integrations/gateway";
import { emitirLinkDePagamento, linksDasCobrancas } from "@/lib/services/gateway-charges";
import { runWithoutScope } from "@/lib/auth/owner-scope";

/**
 * F5.2 — gateway Pix/boleto (decisão 19.10: era da Fase 5, e a Fase 5 chegou).
 *
 * O que importa provar:
 *  1. A emissão publica o pedido e a linha juntos, e NUNCA dois links vivos
 *     para a mesma fatura — dois links é o caminho do pagamento em dobro.
 *  2. A baixa automática entra pelo MESMO pipeline do pagamento manual, e é
 *     idempotente nas DUAS identidades: o mesmo evento reenviado e o mesmo
 *     PAGAMENTO sob outro evento — as duas registram UMA baixa.
 *  3. Assinatura errada morre na porta.
 */

const SEGREDO = "segredo-do-gateway-de-teste";
const ENV = ["GATEWAY_WEBHOOK_SECRET", "GATEWAY_API_URL", "GATEWAY_PROVIDER"] as const;
const antes: Record<string, string | undefined> = {};

function ligar() {
  process.env.GATEWAY_WEBHOOK_SECRET = SEGREDO;
  process.env.GATEWAY_API_URL = "https://exemplo.gateway.test/api";
}

async function entregar(evento: { id: string; type: string; data: Record<string, unknown> }) {
  const corpo = JSON.stringify(evento);
  return receberEventoDoGateway(corpo, `sha256=${assinar(corpo, SEGREDO)}`);
}

describe("F5.2 — link de pagamento e baixa automática", () => {
  let dono: TestOwner;
  let donoAnteriorDoWorkspace: string | null = null;

  beforeAll(async () => {
    dono = await createOwner();
    for (const k of ENV) antes[k] = process.env[k];
    // O workspace de teste precisa de dono para o webhook processar — e o
    // dono ANTERIOR volta no fim, porque o workspace é um singleton que os
    // outros arquivos de teste também usam.
    await runWithoutScope(async () => {
      const ws = await prisma.workspace.findFirstOrThrow({ select: { id: true, ownerId: true } });
      donoAnteriorDoWorkspace = ws.ownerId;
      await prisma.workspace.update({ where: { id: ws.id }, data: { ownerId: dono.id } });
    });
  });

  afterEach(() => {
    for (const k of ENV) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  });

  afterAll(async () => {
    await runWithoutScope(async () => {
      await prisma.webhookInbox.deleteMany({ where: { source: "gateway" } });
      const ws = await prisma.workspace.findFirstOrThrow({ select: { id: true } });
      await prisma.workspace.update({
        where: { id: ws.id },
        data: { ownerId: donoAnteriorDoWorkspace },
      });
    });
    await destroyOwner(dono);
  });

  async function cobrancaAberta(valor = 2000) {
    const c = await createMrrClient(dono);
    const b = await createBilling(dono, c.id, {
      month: 5, year: 2027, amount: valor, dueDate: new Date(2027, 4, 10),
    });
    return { c, b };
  }

  it("sem configuração, a emissão recusa com mensagem de gente", async () => {
    await asOwner(dono, async () => {
      const { b } = await cobrancaAberta();
      const r = await emitirLinkDePagamento(b.id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/ainda não está ativado/i);
    });
  });

  it("emissão cria a linha E o pedido no outbox juntos; a segunda recusa", async () => {
    await asOwner(dono, async () => {
      ligar();
      const { b } = await cobrancaAberta();

      const um = await emitirLinkDePagamento(b.id);
      expect(um.ok).toBe(true);

      const dois = await emitirLinkDePagamento(b.id);
      expect(dois.ok).toBe(false);
      if (!dois.ok) expect(dois.error).toMatch(/já está sendo emitido/i);

      const linhas = await prisma.gatewayCharge.findMany({ where: { billingId: b.id } });
      expect(linhas).toHaveLength(1);
      expect(linhas[0].status).toBe("PENDING");

      const eventos = await prisma.outboxEvent.findMany({
        where: { sourceId: b.id, eventType: "GATEWAY_CHARGE_REQUESTED" },
      });
      expect(eventos).toHaveLength(1);
      expect(eventos[0].channel).toBe("webhook");
      const payload = eventos[0].payload as any;
      expect(payload.valor).toBe(2000);
      expect(payload.cliente.nome).toBeTruthy();
    });
  });

  it("cobrança quitada não emite link", async () => {
    await asOwner(dono, async () => {
      ligar();
      const { b } = await cobrancaAberta(500);
      await prisma.billing.update({
        where: { id: b.id },
        data: { paidTotal: 500, status: "PAID" },
      });
      const r = await emitirLinkDePagamento(b.id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/quitada/i);
    });
  });

  it("charge.created ativa a linha com o link — e a régua passa a enxergá-lo", async () => {
    await asOwner(dono, async () => {
      ligar();
      const { b } = await cobrancaAberta();
      await emitirLinkDePagamento(b.id);

      const r = await entregar({
        id: "evt-created-1-" + b.id,
        type: "charge.created",
        data: { billingId: b.id, chargeId: "ch_" + b.id, link: "https://pag.example/abc123" },
      });
      expect(r.ok && r.situacao).toBe("PROCESSADO");

      const links = await linksDasCobrancas([b.id]);
      expect(links.get(b.id)).toBe("https://pag.example/abc123");
    });
  });

  it("charge.paid dá a baixa pelo pipeline — e as DUAS repetições registram UMA só", async () => {
    await asOwner(dono, async () => {
      ligar();
      const { b } = await cobrancaAberta(1800);
      await emitirLinkDePagamento(b.id);
      await entregar({
        id: "evt-created-2-" + b.id,
        type: "charge.created",
        data: { billingId: b.id, chargeId: "chp_" + b.id, link: "https://pag.example/def" },
      });

      const pago = {
        id: "evt-paid-1-" + b.id,
        type: "charge.paid",
        data: {
          chargeId: "chp_" + b.id, amount: 1800,
          paidAt: "2027-05-12T14:00:00.000Z", method: "pix", paymentId: "pay_777_" + b.id,
        },
      };
      const um = await entregar(pago);
      expect(um.ok && um.situacao).toBe("PROCESSADO");

      // Repetição 1: o MESMO evento (cai na caixa de entrada).
      const dois = await entregar(pago);
      expect(dois.ok && dois.situacao).toBe("REPETIDO");

      // Repetição 2: OUTRO evento, MESMO pagamento (cai na guarda do motor).
      const tres = await entregar({ ...pago, id: "evt-paid-2-" + b.id });
      expect(tres.ok && tres.situacao).toBe("PROCESSADO");
      if (tres.ok) expect(tres.nota).toMatch(/já registrado/i);

      const cobranca = await prisma.billing.findUnique({
        where: { id: b.id },
        select: { status: true, paidTotal: true, payments: true },
      });
      expect(cobranca?.status).toBe("PAID");
      expect(Number(cobranca?.paidTotal)).toBe(1800);
      expect(cobranca?.payments).toHaveLength(1);
      expect(cobranca?.payments[0].method).toBe("PIX");

      const charge = await prisma.gatewayCharge.findFirst({ where: { billingId: b.id } });
      expect(charge?.status).toBe("PAID");
    });
  });

  it("pagamento PARCIAL não quita — e o link continua vivo", async () => {
    await asOwner(dono, async () => {
      ligar();
      const { b } = await cobrancaAberta(1000);
      await emitirLinkDePagamento(b.id);
      await entregar({
        id: "evt-created-3-" + b.id,
        type: "charge.created",
        data: { billingId: b.id, chargeId: "chx_" + b.id, link: "https://pag.example/ghi" },
      });
      const r = await entregar({
        id: "evt-paid-3-" + b.id,
        type: "charge.paid",
        data: { chargeId: "chx_" + b.id, amount: 400, paidAt: "2027-05-11T10:00:00.000Z" },
      });
      expect(r.ok && r.situacao).toBe("PROCESSADO");
      if (r.ok) expect(r.nota).toMatch(/parcial/i);

      const cobranca = await prisma.billing.findUnique({
        where: { id: b.id }, select: { status: true, paidTotal: true },
      });
      expect(cobranca?.status).toBe("PARTIAL");
      expect(Number(cobranca?.paidTotal)).toBe(400);
      const charge = await prisma.gatewayCharge.findFirst({ where: { billingId: b.id } });
      expect(charge?.status).toBe("ACTIVE");
    });
  });

  it("assinatura errada morre na porta; tipo desconhecido fica guardado como ignorado", async () => {
    ligar();
    const corpo = JSON.stringify({ id: "evt-x", type: "charge.paid", data: {} });
    const errada = await receberEventoDoGateway(corpo, "sha256=" + "0".repeat(64));
    expect(errada.ok).toBe(false);
    if (!errada.ok) expect(errada.status).toBe(401);

    const desconhecido = await entregar({
      id: "evt-tipo-novo", type: "charge.refunded", data: {},
    });
    expect(desconhecido.ok && desconhecido.situacao).toBe("IGNORADO");
  });
});
