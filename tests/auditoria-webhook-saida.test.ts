import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { publish, runOutboxWorker } from "@/lib/outbox";
import { entregarNoGateway } from "@/lib/integrations/gateway";
import { assinaturaConfere } from "@/lib/integrations/avancecrm";
import { prisma, runWithoutScope } from "./support/db";

/**
 * WEBHOOK B2C (SAÍDA) — auditoria final (28/09/2026). O entregador REAL do
 * canal `webhook` contra um servidor HTTP local de verdade:
 *  · assinatura válida: o destino confere o HMAC do corpo cru;
 *  · assinatura inválida: segredo diferente não confere;
 *  · retry: destino com erro (500) → o worker reagenda com recuo e guarda o erro;
 *  · destino indisponível: porta fechada e destino que não responde (timeout)
 *    → reagenda, sem travar o lote.
 * (A ENTRADA assinada — AvanceCRM e gateway — está em avancecrm-webhook e
 * gateway-pix.)
 */

const SEGREDO = "segredo-de-teste-com-32-caracteres!!";
let workspaceId: string;
let servidor: http.Server;
let url: string;
let modo: "ok" | "erro" | "trava" = "ok";
const recebidos: { corpo: string; assinatura: string }[] = [];
const envAntes = { url: process.env.GATEWAY_API_URL, seg: process.env.GATEWAY_WEBHOOK_SECRET };

beforeAll(async () => {
  workspaceId = (await runWithoutScope(async () => prisma.workspace.findFirstOrThrow({ select: { id: true } }))).id;
  servidor = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      recebidos.push({ corpo, assinatura: String(req.headers["x-b2c-signature"] ?? "") });
      if (modo === "trava") return; // nunca responde
      res.writeHead(modo === "ok" ? 200 : 500).end();
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/b2c`;
  process.env.GATEWAY_WEBHOOK_SECRET = SEGREDO;
});
afterAll(async () => {
  servidor.closeAllConnections();
  await new Promise((r) => servidor.close(r));
  process.env.GATEWAY_API_URL = envAntes.url;
  process.env.GATEWAY_WEBHOOK_SECRET = envAntes.seg;
  await runWithoutScope(async () => prisma.outboxEvent.deleteMany({ where: { workspaceId, sourceType: "AuditoriaWebhook" } }));
});
beforeEach(async () => {
  recebidos.length = 0;
  modo = "ok";
  process.env.GATEWAY_API_URL = url;
  await runWithoutScope(async () => prisma.outboxEvent.deleteMany({ where: { workspaceId } }));
});

async function publicar(id: string) {
  await runWithoutScope(async () =>
    prisma.$transaction(async (tx) => {
      await publish(tx as any, {
        workspaceId, eventType: "charge.requested", channel: "webhook",
        sourceType: "AuditoriaWebhook", sourceId: id, payload: { valor: 100 },
      });
    })
  );
}
const evento = (sourceId: string) =>
  runWithoutScope(async () => prisma.outboxEvent.findFirstOrThrow({ where: { workspaceId, sourceId } }));
const entregar = (timeoutMs = 1500) => runOutboxWorker((e) => entregarNoGateway(e, { timeoutMs }));

describe("webhook de saída (gateway) — entregador real", () => {
  it("assinatura válida: o destino confere o HMAC do corpo; evento entregue", async () => {
    await publicar("ok-1");
    const r = await entregar();
    expect(r).toMatchObject({ entregues: 1, reagendados: 0 });
    expect(recebidos).toHaveLength(1);
    expect(assinaturaConfere(recebidos[0].corpo, recebidos[0].assinatura, SEGREDO)).toBe(true);
    expect(JSON.parse(recebidos[0].corpo)).toMatchObject({ type: "charge.requested", data: { valor: 100 } });
    expect((await evento("ok-1")).status).toBe("DELIVERED");
  });

  it("assinatura inválida: com outro segredo ou corpo alterado, não confere", async () => {
    await publicar("ok-2");
    await entregar();
    const { corpo, assinatura } = recebidos[0];
    expect(assinaturaConfere(corpo, assinatura, "outro-segredo-qualquer-32-caracteres")).toBe(false);
    expect(assinaturaConfere(corpo.replace("100", "999"), assinatura, SEGREDO)).toBe(false);
  });

  it("retry: destino com erro 500 → reagenda com recuo e guarda o erro; depois entrega", async () => {
    modo = "erro";
    await publicar("retry-1");
    expect(await entregar()).toMatchObject({ entregues: 0, reagendados: 1 });
    const e = await evento("retry-1");
    expect(e).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(e.lastError).toContain("500");
    expect(e.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    // Recuo vencido: a próxima rodada entrega.
    modo = "ok";
    await runWithoutScope(async () => prisma.outboxEvent.update({ where: { id: e.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } }));
    expect(await entregar()).toMatchObject({ entregues: 1 });
    expect((await evento("retry-1")).attempts).toBe(2);
  });

  it("destino indisponível (porta fechada): reagenda sem perder o evento", async () => {
    process.env.GATEWAY_API_URL = "http://127.0.0.1:1/fechado";
    await publicar("off-1");
    expect(await entregar()).toMatchObject({ entregues: 0, reagendados: 1 });
    expect((await evento("off-1")).status).toBe("PENDING");
  });

  it("destino que não responde: a entrega estoura o tempo e o lote segue", async () => {
    modo = "trava";
    await publicar("trava-1");
    const inicio = Date.now();
    const r = await entregar(800);
    expect(Date.now() - inicio).toBeLessThan(5000);
    expect(r).toMatchObject({ entregues: 0, reagendados: 1 });
    expect((await evento("trava-1")).lastError).toMatch(/abort|timeout/i);
  });
});
