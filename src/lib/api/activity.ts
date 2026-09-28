import type { ActivityKind, ActivityResult, ActivitySource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { IDEMPOTENCY_TTL_DIAS, RETENCAO_DIAS } from "./activity-meta";

/**
 * TRILHA DE ATIVIDADES DA API (28/09/2026) — uma linha por chamada.
 *
 * Complementa o AuditLog (que registra a DIFERENÇA campo a campo das
 * entidades e é append-only): aqui fica QUEM chamou, DE ONDE, O QUÊ e COMO
 * TERMINOU — com retenção. Os dois se ligam pelo requestId (= correlationId
 * dos motores).
 *
 * Nunca derruba a requisição: falha ao gravar a trilha vai para o log.
 * Nunca guarda segredo: o metadata passa por `higienizar`.
 */

export type RegistroDeAtividade = {
  ownerId: string;
  serviceAccountId?: string | null;
  actorUserId?: string | null;
  source: ActivitySource;
  kind: ActivityKind;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  requestId: string;
  correlationId?: string | null;
  result: ActivityResult;
  httpStatus: number;
  errorCode?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
};

const PROIBIDAS = /token|secret|segredo|senha|password|authorization|cookie|api[_-]?key|hash/i;
const TOKEN_NO_TEXTO = /b2c_(live|test)_[a-z0-9]{8}_[A-Za-z0-9_-]{20,}/g;

/** Remove chaves sensíveis e qualquer coisa com cara de token, em qualquer nível. */
export function higienizar(v: unknown, nivel = 0): unknown {
  if (nivel > 5) return "[profundo]";
  if (typeof v === "string") return v.replace(TOKEN_NO_TEXTO, "[token removido]").slice(0, 500);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => higienizar(x, nivel + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (PROIBIDAS.test(k)) continue;
      out[k] = higienizar(x, nivel + 1);
    }
    return out;
  }
  return v;
}

/**
 * Origem declarada pelo chamador em `X-B2C-Source` (n8n, whatsapp). Sem o
 * header — ou com valor fora da lista — é "API". WEB e SYSTEM não podem ser
 * declarados de fora: são das chamadas internas.
 */
export function origemDaChamada(req: Request): ActivitySource {
  const v = (req.headers.get("x-b2c-source") ?? "").trim().toLowerCase();
  if (v === "n8n") return "N8N";
  if (v === "whatsapp") return "WHATSAPP";
  return "API";
}

export async function registrarAtividade(r: RegistroDeAtividade): Promise<void> {
  try {
    await runWithoutScope(async () =>
      await prisma.apiActivity.create({
        data: {
          ownerId: r.ownerId,
          serviceAccountId: r.serviceAccountId ?? null,
          actorUserId: r.actorUserId ?? null,
          source: r.source,
          kind: r.kind,
          action: r.action.slice(0, 80),
          entityType: r.entityType ?? null,
          entityId: r.entityId ?? null,
          requestId: r.requestId,
          correlationId: r.correlationId ?? null,
          result: r.result,
          httpStatus: r.httpStatus,
          errorCode: r.errorCode ?? null,
          durationMs: r.durationMs ?? null,
          metadata: r.metadata ? (higienizar(r.metadata) as Prisma.InputJsonValue) : undefined,
        },
      })
    );
  } catch (e) {
    console.error(`[api] falha ao registrar atividade ${r.requestId}`, e);
  }
}

/**
 * RETENÇÃO — roda no job diário. Leituras: 30 dias; escritas: 400 dias
 * (cobre o ano fiscal e a revisão do fechamento); chaves de idempotência:
 * vencidas (30 dias após a primeira chamada). Cada DELETE usa índice
 * (kind, createdAt) / (expiresAt).
 */
export async function aplicarRetencaoDaApi(agora: Date = new Date()) {
  const dia = 86_400_000;
  return runWithoutScope(async () => {
    const leituras = await prisma.apiActivity.deleteMany({
      where: { kind: "READ", createdAt: { lt: new Date(agora.getTime() - RETENCAO_DIAS.READ * dia) } },
    });
    const escritas = await prisma.apiActivity.deleteMany({
      where: { kind: "WRITE", createdAt: { lt: new Date(agora.getTime() - RETENCAO_DIAS.WRITE * dia) } },
    });
    const chaves = await prisma.apiIdempotencyKey.deleteMany({ where: { expiresAt: { lt: agora } } });
    // Ações do agente: a execução já está na trilha (WRITE) e no AuditLog;
    // a proposta guardada vive o mesmo que uma escrita.
    const acoes = await prisma.pendingAction.deleteMany({
      where: { createdAt: { lt: new Date(agora.getTime() - RETENCAO_DIAS.WRITE * dia) } },
    });
    return { leituras: leituras.count, escritas: escritas.count, chavesDeIdempotencia: chaves.count, acoesDoAgente: acoes.count };
  });
}

export const TTL_IDEMPOTENCIA_MS = IDEMPOTENCY_TTL_DIAS * 86_400_000;
