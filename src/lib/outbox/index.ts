import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";

/**
 * TRANSACTIONAL OUTBOX (03 §4.2; 01 §2.20).
 *
 * Duas metades que nunca se misturam:
 *
 *  1. PUBLICAR — `publish(tx, evento)` grava a intenção de entrega DENTRO da
 *     mesma transação do fato financeiro. Se a transação falhar, o evento
 *     some junto: nunca se notifica um pagamento que não foi registrado.
 *
 *  2. ENTREGAR — `runOutboxWorker()` roda FORA da transação, com recuo
 *     exponencial e dead-letter. Se o WhatsApp estiver fora do ar, o
 *     pagamento continua registrado e a entrega tenta de novo.
 *
 * Sem consumidores nesta fase (F0.10): o mecanismo existe e é testável; os
 * canais reais entram na Fase 3 (régua) e 4 (AvanceCRM).
 */

export type OutboxChannel = "whatsapp" | "crm" | "email" | "webhook";

export type PublishInput = {
  workspaceId: string;
  eventType: string;
  channel: OutboxChannel;
  sourceType: string;
  sourceId: string;
  /** Conteúdo MÍNIMO: só o necessário para a entrega (03 §4.2). */
  payload: Prisma.InputJsonValue;
  /** Sobrescreve a chave padrão (evento:origem:id). */
  dedupeKey?: string;
};

/** Cliente de transação do Prisma (o que $transaction entrega ao callback). */
type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/** Chave padrão de deduplicação: um fato gera um evento por canal. */
export function dedupeKeyOf(e: Pick<PublishInput, "eventType" | "sourceType" | "sourceId" | "channel">): string {
  return `${e.eventType}:${e.sourceType}:${e.sourceId}:${e.channel}`;
}

/**
 * Publica DENTRO da transação do fato. Recebe o `tx` de propósito: publicar
 * fora dela quebraria a garantia toda.
 */
export async function publish(tx: TxClient, input: PublishInput): Promise<{ id: string } | null> {
  const dedupeKey = input.dedupeKey ?? dedupeKeyOf(input);
  try {
    return await tx.outboxEvent.create({
      data: {
        workspaceId: input.workspaceId,
        eventType: input.eventType,
        channel: input.channel,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        payload: input.payload,
        dedupeKey,
      },
      select: { id: true },
    });
  } catch (e: any) {
    // Já publicado (unique no banco): não é erro, é a deduplicação agindo.
    if (e?.code === "P2002") return null;
    throw e;
  }
}

// ===================================================================
// Worker de entrega
// ===================================================================

/** Recuo exponencial: 1min, 2, 4, 8, 16, 32, 64... limitado a 6 horas. */
export function backoffMs(attempts: number): number {
  const base = 60_000;
  const teto = 6 * 60 * 60 * 1000;
  return Math.min(base * Math.pow(2, Math.max(0, attempts - 1)), teto);
}

/** Tentativas antes de mandar para o dead-letter. */
export const MAX_ATTEMPTS = 8;

export type Deliverer = (event: {
  id: string;
  eventType: string;
  channel: string;
  sourceType: string;
  sourceId: string;
  payload: unknown;
  attempts: number;
}) => Promise<void>;

export type WorkerResult = {
  processados: number;
  entregues: number;
  reagendados: number;
  deadLetter: number;
};

/**
 * Processa um lote de eventos prontos para entrega.
 *
 * @param deliver função que entrega de verdade (por canal). Lançar exceção
 *                significa "não entregou" — o worker reagenda.
 * @param limit   tamanho do lote.
 */
export async function runOutboxWorker(
  deliver: Deliverer,
  opts: { limit?: number; now?: Date } = {}
): Promise<WorkerResult> {
  const limit = opts.limit ?? 25;
  const resultado: WorkerResult = { processados: 0, entregues: 0, reagendados: 0, deadLetter: 0 };

  // Elegibilidade avaliada pelo BANCO, na MESMA consulta, COM TOLERÂNCIA.
  //
  // O carimbo de `nextAttemptAt` vem do relógio da APLICAÇÃO (o Prisma
  // resolve `now()` no cliente, com precisão de milissegundo) e a comparação
  // usa o relógio do BANCO. Os dois não coincidem: medido aqui, uma linha
  // gravada em .148000 contra um NOW() de .147966 — o carimbo nasce 34
  // microssegundos NO FUTURO e o evento fica invisível até a rodada seguinte.
  // Reproduzido em 4 de 30 ciclos.
  //
  // A tolerância de 1 segundo mata a classe inteira do problema, inclusive a
  // defasagem real entre servidores em produção, que é muito maior que
  // microssegundos. É inofensiva: o menor recuo entre tentativas é 1 minuto.
  //
  // `opts.now` continua para os testes fixarem o relógio.
  const lote = await runWithoutScope(async () =>
    opts.now
      ? prisma.outboxEvent.findMany({
          where: { status: "PENDING", nextAttemptAt: { lte: opts.now } },
          orderBy: { nextAttemptAt: "asc" },
          take: limit,
          select: {
            id: true, eventType: true, channel: true,
            sourceType: true, sourceId: true, payload: true, attempts: true,
          },
        })
      : prisma.$queryRaw<
          {
            id: string; eventType: string; channel: string;
            sourceType: string; sourceId: string; payload: unknown; attempts: number;
          }[]
        >`
          SELECT "id", "eventType", "channel", "sourceType", "sourceId", "payload", "attempts"
            FROM "OutboxEvent"
           WHERE "status" = 'PENDING'::"OutboxStatus"
             AND "nextAttemptAt" <= NOW() + INTERVAL '1 second' 
           ORDER BY "nextAttemptAt" ASC
           LIMIT ${limit}
        `
  );

  for (const evento of lote) {
    resultado.processados++;
    const tentativa = evento.attempts + 1;
    try {
      await deliver(evento);
      await runWithoutScope(async () =>
        prisma.outboxEvent.update({
          where: { id: evento.id },
          data: {
            status: "DELIVERED",
            attempts: tentativa,
            deliveredAt: new Date(),
            lastError: null,
          },
        })
      );
      resultado.entregues++;
    } catch (erro: any) {
      const mensagem = String(erro?.message ?? erro).slice(0, 500);
      const esgotou = tentativa >= MAX_ATTEMPTS;
      await runWithoutScope(async () =>
        prisma.outboxEvent.update({
          where: { id: evento.id },
          data: {
            attempts: tentativa,
            lastError: mensagem,
            ...(esgotou
              ? { status: "DEAD_LETTER" as const }
              : {
                  // Reagendamento é sempre no FUTURO (≥ 1 minuto): aqui o
                  // relógio da aplicação basta, milissegundos não pesam.
                  status: "PENDING" as const,
                  nextAttemptAt: new Date((opts.now ?? new Date()).getTime() + backoffMs(tentativa)),
                }),
          },
        })
      );
      if (esgotou) resultado.deadLetter++;
      else resultado.reagendados++;
    }
  }

  return resultado;
}

/**
 * Devolve um evento do dead-letter para a fila (depois de corrigir a causa).
 * Ação humana e auditável — nunca automática.
 */
export async function requeue(id: string): Promise<boolean> {
  const r = await runWithoutScope(async () =>
    prisma.outboxEvent.updateMany({
      where: { id, status: "DEAD_LETTER" },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null },
    })
  );
  return r.count > 0;
}

/** Panorama da fila — alimenta o alerta de "outbox em falha" (03 §4.6). */
export async function outboxHealth(workspaceId: string) {
  const porStatus = await runWithoutScope(async () =>
    prisma.outboxEvent.groupBy({
      by: ["status"],
      where: { workspaceId },
      _count: { _all: true },
    })
  );
  const mapa = Object.fromEntries(porStatus.map((s) => [s.status, s._count._all]));
  return {
    pendentes: mapa.PENDING ?? 0,
    entregues: mapa.DELIVERED ?? 0,
    deadLetter: mapa.DEAD_LETTER ?? 0,
    cancelados: mapa.CANCELED ?? 0,
  };
}
