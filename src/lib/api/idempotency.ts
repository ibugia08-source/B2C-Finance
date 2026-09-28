import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { ApiError, type ApiAuth } from "./auth";
import { TTL_IDEMPOTENCIA_MS } from "./activity";

/**
 * IDEMPOTENCY-KEY (28/09/2026) — docs/API_AUDIT_IDEMPOTENCY.md.
 *
 * Regra: a MESMA conta de serviço + a MESMA chave executa a operação UMA vez.
 *  · 1ª chamada → reserva a chave (IN_PROGRESS, índice único) → executa →
 *    guarda status e corpo da resposta (COMPLETED).
 *  · Repetição com o mesmo corpo → devolve a resposta guardada, marcada como
 *    replay. Nada é executado de novo.
 *  · Repetição enquanto a 1ª ainda roda → 409 (tente de novo em instantes).
 *  · Mesma chave com outro corpo ou outra operação → 422: é quase certamente
 *    um bug no chamador, e executar seria o pior desfecho.
 *
 * Só se guarda o que é SEGURO repetir: sucesso (2xx) e recusa de regra de
 * negócio (422). Erro de servidor, 404 e afins LIBERAM a chave — a próxima
 * tentativa executa de verdade, que é o que o chamador precisa.
 */

const FORMATO = /^[A-Za-z0-9._:-]{1,255}$/;

export function chaveDeIdempotencia(req: Request): string {
  const k = req.headers.get("idempotency-key")?.trim();
  if (!k) {
    throw new ApiError(400, "idempotency_key_required", "Escritas exigem o header Idempotency-Key (ex.: wa_message_3EB0C4…).");
  }
  if (!FORMATO.test(k)) {
    throw new ApiError(400, "validation_error", "Idempotency-Key inválida: use 1 a 255 caracteres entre A-Z, a-z, 0-9, . _ : -");
  }
  return k;
}

/** JSON canônico (chaves ordenadas) → SHA-256. Mesma intenção = mesmo hash. */
export function hashDoPedido(v: unknown): string {
  const canon = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(canon)
      : x && typeof x === "object" && !(x instanceof Date)
        ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canon((x as any)[k])]))
        : x;
  return createHash("sha256").update(JSON.stringify(canon(v) ?? null)).digest("hex");
}

export type Reserva =
  | { tipo: "nova"; id: string }
  | { tipo: "replay"; status: number; body: unknown; originalRequestId: string; firstProcessedAt: Date };

export async function reservarChave(p: {
  auth: ApiAuth;
  key: string;
  operation: string;
  requestHash: string;
  requestId: string;
  agora?: Date;
}): Promise<Reserva> {
  const agora = p.agora ?? new Date();
  return runWithoutScope(async () => {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      // Lê antes de criar: a repetição (caso comum) não passa por um erro de
      // chave única — que o Prisma registraria no log a cada replay. A trava
      // única continua sendo quem decide a corrida entre duas chamadas.
      const existente = await prisma.apiIdempotencyKey.findUnique({
        where: { serviceAccountId_key: { serviceAccountId: p.auth.serviceAccountId, key: p.key } },
        select: { id: true },
      });
      if (!existente) {
        try {
          const nova = await prisma.apiIdempotencyKey.create({
            data: {
              ownerId: p.auth.ownerId,
              serviceAccountId: p.auth.serviceAccountId,
              key: p.key,
              operation: p.operation,
              requestHash: p.requestHash,
              requestId: p.requestId,
              expiresAt: new Date(agora.getTime() + TTL_IDEMPOTENCIA_MS),
            },
            select: { id: true },
          });
          return { tipo: "nova" as const, id: nova.id };
        } catch (e) {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
        }
      }
      const atual = await prisma.apiIdempotencyKey.findUnique({
        where: { serviceAccountId_key: { serviceAccountId: p.auth.serviceAccountId, key: p.key } },
      });
      if (!atual) continue; // apagada entre as duas consultas: tenta criar de novo
      if (atual.expiresAt <= agora) {
        // Vencida (o job ainda não passou): vale como chave nova.
        await prisma.apiIdempotencyKey.deleteMany({ where: { id: atual.id, expiresAt: { lte: agora } } });
        continue;
      }
      if (atual.operation !== p.operation || atual.requestHash !== p.requestHash) {
        throw new ApiError(
          422,
          "idempotency_key_reused",
          "Esta Idempotency-Key já foi usada em outra operação ou com outros dados. Gere uma chave nova para um pedido novo."
        );
      }
      if (atual.state === "IN_PROGRESS") {
        // Presa há mais de 2 minutos: a 1ª chamada provavelmente executou, mas
        // o resultado não foi guardado. Repetir às cegas pode duplicar.
        const presa = agora.getTime() - atual.createdAt.getTime() > 2 * 60_000;
        throw new ApiError(
          409,
          "idempotency_in_progress",
          presa
            ? "A primeira chamada com esta Idempotency-Key não terminou de registrar o resultado. Confira no B2C Finance se a operação aconteceu antes de repetir com uma chave nova."
            : "Uma chamada com esta Idempotency-Key ainda está em andamento. Tente de novo em instantes."
        );
      }
      return {
        tipo: "replay" as const,
        status: atual.responseStatus!,
        body: atual.responseBody,
        originalRequestId: atual.requestId,
        firstProcessedAt: atual.completedAt ?? atual.createdAt,
      };
    }
    throw new ApiError(409, "idempotency_in_progress", "Não foi possível reservar a Idempotency-Key. Tente de novo.");
  });
}

/** Resposta que pode ser devolvida de novo sem risco. */
export const guardavel = (status: number) => (status >= 200 && status < 300) || status === 422;

export async function concluirChave(id: string, status: number, body: unknown) {
  await runWithoutScope(async () =>
    await prisma.apiIdempotencyKey.update({
      where: { id },
      data: { state: "COMPLETED", responseStatus: status, responseBody: body as Prisma.InputJsonValue, completedAt: new Date() },
    })
  );
}

/** Libera a chave: a próxima tentativa executa de verdade. */
export async function liberarChave(id: string) {
  try {
    await runWithoutScope(async () => await prisma.apiIdempotencyKey.deleteMany({ where: { id, state: "IN_PROGRESS" } }));
  } catch (e) {
    console.error("[api] falha ao liberar Idempotency-Key", e);
  }
}
