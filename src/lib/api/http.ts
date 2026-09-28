import { randomUUID } from "crypto";
import { z, type ZodTypeAny } from "zod";
import { runWithPrincipal } from "@/lib/auth/owner-scope";
import type { DomainContext } from "@/lib/engines/domain";
import { DomainNotFoundError } from "@/lib/engines/domain";
import { ApiError, apiDomainContext, authenticateApiToken, requireApiScope, type ApiAuth } from "./auth";

/**
 * CONTRATO HTTP DA API /api/v1 (docs/API.md).
 *
 * Sucesso: { success: true,  data, meta: { requestId, generatedAt, ... } }
 * Erro:    { success: false, error: { code, message, ... }, meta: { requestId } }
 *
 * `defineEndpoint` é a única forma de escrever uma rota: autentica a conta
 * de serviço, confere o scope, valida query e params com Zod, roda o
 * handler sob o dono da conta (a extensão do Prisma escopa tudo por ele) e
 * converte qualquer erro no formato acima — sem stack, sem mensagem interna.
 */

const SEM_CACHE = { "Cache-Control": "no-store" };

export function novoRequestId(req: Request): string {
  const vindo = req.headers.get("x-request-id") || req.headers.get("x-correlation-id");
  // Só aceita um id "bem-comportado" vindo de fora (vai para log e header).
  return vindo && /^[A-Za-z0-9._:-]{1,100}$/.test(vindo) ? vindo : randomUUID();
}

function json(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SEM_CACHE,
      "x-request-id": requestId,
    },
  });
}

export function apiSuccess(data: unknown, requestId: string, meta: Record<string, unknown> = {}): Response {
  return json(
    { success: true, data, meta: { requestId, generatedAt: new Date().toISOString(), ...meta } },
    200,
    requestId
  );
}

export function apiFailure(err: ApiError, requestId: string): Response {
  const res = json(
    {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.scope ? { scope: err.scope } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      meta: { requestId },
    },
    err.status,
    requestId
  );
  // RFC 6750 §3: o cliente sabe se é credencial (401) ou escopo (403).
  if (err.status === 401) {
    res.headers.set(
      "WWW-Authenticate",
      err.code === "missing_token" ? 'Bearer realm="b2c-api"' : 'Bearer realm="b2c-api", error="invalid_token"'
    );
  } else if (err.code === "insufficient_scope") {
    res.headers.set("WWW-Authenticate", `Bearer realm="b2c-api", error="insufficient_scope", scope="${err.scope}"`);
  }
  return res;
}

export const naoEncontrado = (rotulo: string) => new ApiError(404, "not_found", `${rotulo} não encontrado.`);

function erroDeValidacao(onde: "query" | "params", e: z.ZodError): ApiError {
  return new ApiError(
    400,
    "validation_error",
    onde === "query" ? "Parâmetros de consulta inválidos." : "Parâmetros de rota inválidos.",
    undefined,
    e.issues.map((i) => ({ field: i.path.join(".") || null, message: i.message }))
  );
}

/** Query string → objeto (a primeira ocorrência de cada chave). */
function queryDe(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URL(req.url).searchParams) if (!(k in out)) out[k] = v;
  return out;
}

export type EndpointArgs<Q, P> = {
  req: Request;
  auth: ApiAuth;
  ctx: DomainContext;
  query: Q;
  params: P;
  requestId: string;
};

export type EndpointResult = { data: unknown; meta?: Record<string, unknown> };

export function defineEndpoint<Q extends ZodTypeAny = z.ZodObject<{}>, P extends ZodTypeAny = z.ZodObject<{}>>(
  opts: { scope: string | null; query?: Q; params?: P },
  handler: (args: EndpointArgs<z.output<Q>, z.output<P>>) => Promise<EndpointResult>
) {
  return async (req: Request, route?: { params?: Record<string, string | string[]> }): Promise<Response> => {
    const requestId = novoRequestId(req);
    try {
      const res = await authenticateApiToken(req.headers.get("authorization"));
      if (!res.ok) return apiFailure(res.error, requestId);
      const auth = res.auth;
      if (opts.scope) requireApiScope(auth, opts.scope);

      // Parâmetros desconhecidos são recusados (schemas `.strict()`): um
      // filtro digitado errado que fosse ignorado devolveria a lista inteira
      // — e o agente acharia que filtrou.
      const q = (opts.query ?? z.object({}).strict()).safeParse(queryDe(req));
      if (!q.success) throw erroDeValidacao("query", q.error);
      const p = (opts.params ?? z.object({}).passthrough()).safeParse(route?.params ?? {});
      if (!p.success) throw erroDeValidacao("params", p.error);

      const ctx = apiDomainContext(auth, requestId);
      const out = await runWithPrincipal(auth.ownerId, auth.principal, async () =>
        await handler({ req, auth, ctx, query: q.data, params: p.data, requestId })
      );
      return apiSuccess(out.data, requestId, out.meta);
    } catch (e) {
      if (e instanceof ApiError) return apiFailure(e, requestId);
      if (e instanceof DomainNotFoundError) return apiFailure(new ApiError(404, "not_found", e.message), requestId);
      // Nada do erro interno vai para a resposta; o requestId liga ao log.
      console.error(`[api] ${requestId} ${new URL(req.url).pathname}`, e);
      return apiFailure(new ApiError(500, "internal_error", "Erro interno. Informe o requestId ao suporte."), requestId);
    }
  };
}

// ---------------------------------------------------------------------------
// Peças de schema e serialização reaproveitadas pelas rotas
// ---------------------------------------------------------------------------

export const PAGE_SIZE_PADRAO = 50;
export const PAGE_SIZE_MAX = 200;

export const paginacao = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_PADRAO),
};

export function metaDePaginacao(page: number, pageSize: number, total: number) {
  return { pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export function fatiar<T>(itens: T[], page: number, pageSize: number): T[] {
  return itens.slice((page - 1) * pageSize, page * pageSize);
}

export const competenciaSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use o formato AAAA-MM (ex.: 2026-09).");

export const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Data inválida.");

export const idSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Id inválido.");

/** Decimal do Prisma (ou número/texto) → número JSON; null continua null. */
export function dinheiro(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(typeof v === "object" ? String(v) : v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function instante(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}
