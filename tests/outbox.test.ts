import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  publish, runOutboxWorker, requeue, outboxHealth,
  backoffMs, dedupeKeyOf, MAX_ATTEMPTS,
} from "@/lib/outbox";
import { prisma, runWithoutScope } from "./support/db";

/**
 * TRANSACTIONAL OUTBOX — ref. 03 §4.2; 01 §2.20.
 * O que estes testes protegem: notificação nunca é entregue para um fato que
 * não foi gravado, e fato gravado nunca perde a notificação em silêncio.
 */

let workspaceId: string;

beforeAll(async () => {
  const ws = await runWithoutScope(async () =>
    prisma.workspace.findFirstOrThrow({ select: { id: true } })
  );
  workspaceId = ws.id;
});
afterAll(async () => {
  await runWithoutScope(async () => prisma.outboxEvent.deleteMany({ where: { workspaceId } }));
});
beforeEach(async () => {
  await runWithoutScope(async () => prisma.outboxEvent.deleteMany({ where: { workspaceId } }));
});

const evento = (over: Partial<Parameters<typeof publish>[1]> = {}) => ({
  workspaceId,
  eventType: "PAYMENT_RECEIVED",
  channel: "whatsapp" as const,
  sourceType: "Payment",
  sourceId: "pay-1",
  payload: { valor: 1000 },
  ...over,
});

describe("publicação dentro da transação", () => {
  it("grava o evento junto com o fato", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => {
        await publish(tx as any, evento());
      })
    );
    const n = await runWithoutScope(async () => prisma.outboxEvent.count({ where: { workspaceId } }));
    expect(n).toBe(1);
  });

  it("a transação desfeita leva o evento junto — nunca notifica fato inexistente", async () => {
    await expect(
      runWithoutScope(async () =>
        prisma.$transaction(async (tx) => {
          await publish(tx as any, evento({ sourceId: "pay-rollback" }));
          throw new Error("fato financeiro falhou");
        })
      )
    ).rejects.toThrow("fato financeiro falhou");

    const n = await runWithoutScope(async () =>
      prisma.outboxEvent.count({ where: { workspaceId, sourceId: "pay-rollback" } })
    );
    expect(n).toBe(0);
  });

  it("o mesmo fato não publica duas vezes (dedupe no banco)", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => { await publish(tx as any, evento()); })
    );
    const repetido = await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => publish(tx as any, evento()))
    );
    expect(repetido).toBeNull(); // deduplicado, sem erro
    const n = await runWithoutScope(async () => prisma.outboxEvent.count({ where: { workspaceId } }));
    expect(n).toBe(1);
  });

  it("canais diferentes do mesmo fato são eventos distintos", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => {
        await publish(tx as any, evento({ channel: "whatsapp" }));
        await publish(tx as any, evento({ channel: "email" }));
      })
    );
    const n = await runWithoutScope(async () => prisma.outboxEvent.count({ where: { workspaceId } }));
    expect(n).toBe(2);
  });

  it("a chave de deduplicação nomeia evento, origem e canal", () => {
    expect(dedupeKeyOf({
      eventType: "PAYMENT_RECEIVED", sourceType: "Payment", sourceId: "p1", channel: "crm",
    })).toBe("PAYMENT_RECEIVED:Payment:p1:crm");
  });
});

describe("recuo exponencial", () => {
  it("dobra a cada tentativa e para em 6 horas", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(10)).toBe(6 * 60 * 60 * 1000); // teto
    expect(backoffMs(50)).toBe(6 * 60 * 60 * 1000);
  });
});

describe("worker de entrega", () => {
  it("entrega e marca como entregue", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => { await publish(tx as any, evento()); })
    );
    const entregues: string[] = [];
    const r = await runOutboxWorker(async (e) => { entregues.push(e.sourceId); });

    expect(r).toMatchObject({ processados: 1, entregues: 1, reagendados: 0, deadLetter: 0 });
    expect(entregues).toEqual(["pay-1"]);

    const e = await runWithoutScope(async () =>
      prisma.outboxEvent.findFirstOrThrow({ where: { workspaceId } })
    );
    expect(e.status).toBe("DELIVERED");
    expect(e.attempts).toBe(1);
    expect(e.deliveredAt).not.toBeNull();
  });

  it("falha reagenda com recuo, guardando o erro", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => { await publish(tx as any, evento()); })
    );
    // O "agora" precisa ser posterior ao agendamento do evento (que nasce
    // com nextAttemptAt = now()), senão o worker nem o seleciona.
    const agora = new Date(Date.now() + 1_000);
    const r = await runOutboxWorker(async () => { throw new Error("WhatsApp fora do ar"); }, { now: agora });

    expect(r.reagendados).toBe(1);
    const e = await runWithoutScope(async () =>
      prisma.outboxEvent.findFirstOrThrow({ where: { workspaceId } })
    );
    expect(e.status).toBe("PENDING");
    expect(e.attempts).toBe(1);
    expect(e.lastError).toMatch(/fora do ar/);
    expect(e.nextAttemptAt.getTime()).toBe(agora.getTime() + 60_000);
  });

  it("não tenta antes da hora marcada", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => { await publish(tx as any, evento()); })
    );
    await runWithoutScope(async () =>
      prisma.outboxEvent.updateMany({
        where: { workspaceId },
        data: { nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000) },
      })
    );
    const r = await runOutboxWorker(async () => { throw new Error("não deveria tentar"); });
    expect(r.processados).toBe(0);
  });

  it("esgotadas as tentativas, vai para o dead-letter", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => { await publish(tx as any, evento()); })
    );
    await runWithoutScope(async () =>
      prisma.outboxEvent.updateMany({
        where: { workspaceId },
        data: { attempts: MAX_ATTEMPTS - 1 },
      })
    );
    const r = await runOutboxWorker(async () => { throw new Error("destino morto"); });
    expect(r.deadLetter).toBe(1);

    const e = await runWithoutScope(async () =>
      prisma.outboxEvent.findFirstOrThrow({ where: { workspaceId } })
    );
    expect(e.status).toBe("DEAD_LETTER");
    expect(e.attempts).toBe(MAX_ATTEMPTS);
  });

  it("dead-letter volta para a fila só por ação explícita", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => { await publish(tx as any, evento()); })
    );
    await runWithoutScope(async () =>
      prisma.outboxEvent.updateMany({
        where: { workspaceId }, data: { status: "DEAD_LETTER", attempts: MAX_ATTEMPTS },
      })
    );
    // O worker ignora dead-letter.
    expect((await runOutboxWorker(async () => {})).processados).toBe(0);

    const e = await runWithoutScope(async () =>
      prisma.outboxEvent.findFirstOrThrow({ where: { workspaceId }, select: { id: true } })
    );
    expect(await requeue(e.id)).toBe(true);
    expect((await runOutboxWorker(async () => {})).entregues).toBe(1);
  });

  it("um evento que falha não impede a entrega dos outros", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => {
        await publish(tx as any, evento({ sourceId: "ok-1" }));
        await publish(tx as any, evento({ sourceId: "ruim" }));
        await publish(tx as any, evento({ sourceId: "ok-2" }));
      })
    );
    const r = await runOutboxWorker(async (e) => {
      if (e.sourceId === "ruim") throw new Error("falhou");
    });
    expect(r).toMatchObject({ processados: 3, entregues: 2, reagendados: 1 });
  });

  it("o panorama da fila alimenta o alerta de falha", async () => {
    await runWithoutScope(async () =>
      prisma.$transaction(async (tx) => {
        await publish(tx as any, evento({ sourceId: "a" }));
        await publish(tx as any, evento({ sourceId: "b" }));
      })
    );
    await runOutboxWorker(async (e) => { if (e.sourceId === "b") throw new Error("x"); });
    const saude = await outboxHealth(workspaceId);
    expect(saude.entregues).toBe(1);
    expect(saude.pendentes).toBe(1);
  });
});
