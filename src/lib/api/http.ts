import { randomUUID } from "crypto";
import { z, type ZodTypeAny } from "zod";
import { runWithPrincipal, runWithoutScope } from "@/lib/auth/owner-scope";
import { prisma } from "@/lib/prisma";
import type { DomainContext } from "@/lib/engines/domain";
import { DomainNotFoundError } from "@/lib/engines/domain";
import { ApiError, apiDomainContext, authenticateApiToken, requireApiScope, type ApiAuth } from "./auth";
import { origemDaChamada, registrarAtividade } from "./activity";
import { delegar } from "./delegation";
import { chaveDeIdempotencia, concluirChave, guardavel, hashDoPedido, liberarChave, reservarChave, type Reserva } from "./idempotency";
import type { WriteOperationKey } from "./activity-meta";

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

type Corpo = Record<string, unknown>;

function corpoDeSucesso(data: unknown, requestId: string, meta: Record<string, unknown> = {}): Corpo {
  return { success: true, data, meta: { requestId, generatedAt: new Date().toISOString(), ...meta } };
}

function corpoDeErro(err: ApiError, requestId: string): Corpo {
  return {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      ...(err.scope ? { scope: err.scope } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
    meta: { requestId },
  };
}

function responder(status: number, corpo: Corpo, requestId: string, extra: Record<string, string> = {}): Response {
  const res = json(corpo, status, requestId);
  for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
  return res;
}

export function apiSuccess(data: unknown, requestId: string, meta: Record<string, unknown> = {}): Response {
  return json(corpoDeSucesso(data, requestId, meta), 200, requestId);
}

function cabecalhosDeErro(err: ApiError): Record<string, string> {
  // RFC 6750 §3: o cliente sabe se é credencial (401) ou escopo (403).
  if (err.status === 401) {
    return {
      "WWW-Authenticate":
        err.code === "missing_token" ? 'Bearer realm="b2c-api"' : 'Bearer realm="b2c-api", error="invalid_token"',
    };
  }
  if (err.code === "insufficient_scope") {
    return { "WWW-Authenticate": `Bearer realm="b2c-api", error="insufficient_scope", scope="${err.scope}"` };
  }
  if (err.status === 429) return { "Retry-After": "60" };
  return {};
}

export function apiFailure(err: ApiError, requestId: string): Response {
  return responder(err.status, corpoDeErro(err, requestId), requestId, cabecalhosDeErro(err));
}

export const naoEncontrado = (rotulo: string) => new ApiError(404, "not_found", `${rotulo} não encontrado.`);

function erroDeValidacao(onde: "query" | "params" | "body", e: z.ZodError): ApiError {
  return new ApiError(
    400,
    "validation_error",
    onde === "query" ? "Parâmetros de consulta inválidos." : onde === "body" ? "Corpo da requisição inválido." : "Parâmetros de rota inválidos.",
    undefined,
    e.issues.map((i) => ({ field: i.path.join(".") || null, message: i.message }))
  );
}

/**
 * Query string → objeto (a primeira ocorrência de cada chave). Valor VAZIO
 * (`competence=`) conta como ausente: ferramentas de agente (n8n) mandam o
 * parâmetro opcional em branco quando o modelo não o preenche, e isso não é
 * um filtro — recusar com 400 só atrapalharia. Chave desconhecida continua
 * sendo recusada, vazia ou não.
 */
function queryDe(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URL(req.url).searchParams) {
    if (k in out) continue;
    if (v.trim() === "") {
      out[k] = undefined as unknown as string;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export type EndpointArgs<Q, P> = {
  req: Request;
  auth: ApiAuth;
  ctx: DomainContext;
  query: Q;
  params: P;
  requestId: string;
  /** Escritas: a Idempotency-Key desta chamada (null em leituras). */
  idempotencyKey: string | null;
};

export type EndpointResult = {
  data: unknown;
  meta?: Record<string, unknown>;
  /** Padrão 200. Criação: 201. */
  status?: number;
  /** O que a trilha de atividades registra sobre esta chamada. */
  audit?: {
    entityType?: string;
    entityId?: string;
    /** Rótulo humano para a tela (ex.: nome do cliente). */
    label?: string;
    /** Valor em reais envolvido, quando houver. */
    amount?: number | null;
    metadata?: Record<string, unknown>;
  };
};

export type EndpointOptions<Q, P, B> = {
  /** Ação estável para a trilha ("clients.list", "payments.register"…). */
  action: string;
  scope: string | null;
  query?: Q;
  params?: P;
  /** Corpo JSON (escritas). */
  body?: B;
  /** Escrita: exige Idempotency-Key e registra como WRITE. */
  write?: { operation: WriteOperationKey };
  /** false = não registra na trilha (só /health, chamado por monitor). */
  audit?: boolean;
  /**
   * Limite POR USUÁRIO do vínculo (X-B2C-Identity) nesta ação, na janela.
   * Conta na própria trilha (ApiActivity) — vale entre instâncias, sem
   * infraestrutura nova. Complementa o limite por IP do middleware.
   */
  limitePorUsuario?: { max: number; janelaSegundos: number };
  /**
   * Permissão FINA do RBAC exigida do usuário do vínculo, além do scope (ex.:
   * a tela de Inadimplência exige `recebimentos.ver_inadimplencia`, mais que
   * "ver recebimentos"). Sem delegação vale só o scope da integração.
   */
  permissaoDoUsuario?: string;
};

/** Quantas chamadas desta ação o usuário fez na janela (tentativas recusadas não contam). */
async function chamadasRecentes(ownerId: string, userId: string, action: string, janelaSegundos: number): Promise<number> {
  return runWithoutScope(async () =>
    await prisma.apiActivity.count({
      where: {
        ownerId, actorUserId: userId, action,
        result: { not: "DENIED" },
        createdAt: { gte: new Date(Date.now() - janelaSegundos * 1000) },
      },
    })
  );
}

export function defineEndpoint<
  Q extends ZodTypeAny = z.ZodObject<{}>,
  P extends ZodTypeAny = z.ZodObject<{}>,
  B extends ZodTypeAny = z.ZodUndefined,
>(
  opts: EndpointOptions<Q, P, B>,
  handler: (args: EndpointArgs<z.output<Q>, z.output<P>> & { body: z.output<B> }) => Promise<EndpointResult>
) {
  const kind = opts.write ? ("WRITE" as const) : ("READ" as const);
  const action = opts.write?.operation ?? opts.action;

  return async (req: Request, route?: { params?: Record<string, string | string[]> }): Promise<Response> => {
    const inicio = Date.now();
    const requestId = novoRequestId(req);
    const source = origemDaChamada(req);
    let auth: ApiAuth | null = null;
    let reserva: Reserva | null = null;
    let chave: string | null = null;

    const trilha = async (r: {
      ownerId: string;
      serviceAccountId: string | null;
      result: "SUCCESS" | "ERROR" | "DENIED" | "REPLAYED";
      httpStatus: number;
      errorCode?: string | null;
      audit?: EndpointResult["audit"];
    }) => {
      if (opts.audit === false) return;
      const { label, amount, metadata, entityType, entityId } = r.audit ?? {};
      await registrarAtividade({
        ownerId: r.ownerId,
        serviceAccountId: r.serviceAccountId,
        actorUserId: auth?.delegacao?.userId ?? null,
        source,
        kind,
        action,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        requestId,
        correlationId: req.headers.get("x-correlation-id"),
        result: r.result,
        httpStatus: r.httpStatus,
        errorCode: r.errorCode ?? null,
        durationMs: Date.now() - inicio,
        metadata: {
          ...(label ? { label } : {}),
          ...(amount != null ? { amount } : {}),
          ...(chave ? { idempotencyKey: chave } : {}),
          method: req.method,
          path: new URL(req.url).pathname,
          ...(metadata ?? {}),
        },
      });
    };

    try {
      const res = await authenticateApiToken(req.headers.get("authorization"));
      if (!res.ok) {
        // Token que confere mas não vale (revogado, expirado): a tentativa
        // entra na trilha do dono. Token desconhecido não tem dono a quem contar.
        if (res.conta) {
          await trilha({ ownerId: res.conta.ownerId, serviceAccountId: res.conta.serviceAccountId, result: "DENIED", httpStatus: 401, errorCode: res.error.code });
        }
        return apiFailure(res.error, requestId);
      }
      auth = res.auth;
      // Delegação: a integração age em nome do usuário do vínculo (os scopes
      // viram conta ∩ RBAC dele). Ver lib/api/delegation.
      const identidade = req.headers.get("x-b2c-identity");
      if (identidade !== null) auth = await delegar(auth, identidade);
      if (opts.scope) {
        if (auth.delegacao && !auth.scopes.includes(opts.scope) && auth.delegacao.scopesDaConta.includes(opts.scope)) {
          throw new ApiError(403, "user_forbidden", `${auth.delegacao.userName} não tem permissão para isto no B2C Finance.`, opts.scope);
        }
        requireApiScope(auth, opts.scope);
      }
      if (opts.permissaoDoUsuario && auth.delegacao && !auth.delegacao.pode(opts.permissaoDoUsuario)) {
        throw new ApiError(403, "user_forbidden", `${auth.delegacao.userName} não tem permissão para isto no B2C Finance.`, opts.scope ?? undefined);
      }
      if (opts.limitePorUsuario && auth.delegacao) {
        const { max, janelaSegundos } = opts.limitePorUsuario;
        if ((await chamadasRecentes(auth.ownerId, auth.delegacao.userId, action, janelaSegundos)) >= max) {
          throw new ApiError(429, "rate_limited", "Muitas ações em pouco tempo. Aguarde um minuto e tente de novo.");
        }
      }

      // Parâmetros desconhecidos são recusados (schemas `.strict()`): um
      // filtro digitado errado que fosse ignorado devolveria a lista inteira
      // — e o agente acharia que filtrou.
      const q = (opts.query ?? z.object({}).strict()).safeParse(queryDe(req));
      if (!q.success) throw erroDeValidacao("query", q.error);
      const p = (opts.params ?? z.object({}).passthrough()).safeParse(route?.params ?? {});
      if (!p.success) throw erroDeValidacao("params", p.error);
      let corpo: unknown = undefined;
      if (opts.body) {
        let cru: unknown;
        const texto = await req.text();
        if (!texto.trim()) cru = {}; // POST sem corpo (ex.: /expenses/:id/pay) = objeto vazio
        else {
          try {
            cru = JSON.parse(texto);
          } catch {
            throw new ApiError(400, "validation_error", "Corpo da requisição não é JSON válido.");
          }
        }
        const b = opts.body.safeParse(cru);
        if (!b.success) throw erroDeValidacao("body", b.error);
        corpo = b.data;
      }

      // IDEMPOTÊNCIA — depois de validar (pedido inválido não queima a chave).
      if (opts.write) {
        chave = chaveDeIdempotencia(req);
        reserva = await reservarChave({
          auth,
          key: chave,
          operation: opts.write.operation,
          requestHash: hashDoPedido({ params: p.data, query: q.data, body: corpo }),
          requestId,
        });
        if (reserva.tipo === "replay") {
          const antigo = (reserva.body ?? {}) as Corpo;
          const replay: Corpo = {
            ...antigo,
            meta: {
              ...((antigo.meta as Corpo) ?? {}),
              requestId,
              idempotency: {
                key: chave,
                replayed: true,
                originalRequestId: reserva.originalRequestId,
                firstProcessedAt: reserva.firstProcessedAt.toISOString(),
              },
            },
          };
          await trilha({
            ownerId: auth.ownerId, serviceAccountId: auth.serviceAccountId, result: "REPLAYED", httpStatus: reserva.status,
            audit: { metadata: { originalRequestId: reserva.originalRequestId } },
          });
          return responder(reserva.status, replay, requestId, { "Idempotent-Replayed": "true" });
        }
      }

      const ctx = apiDomainContext(auth, requestId);
      const a = auth;
      const out = await runWithPrincipal(auth.ownerId, auth.principal, async () =>
        await handler({ req, auth: a, ctx, query: q.data, params: p.data, body: corpo as z.output<B>, requestId, idempotencyKey: chave })
      );
      const status = out.status ?? 200;
      const sucesso = corpoDeSucesso(out.data, requestId, {
        ...(out.meta ?? {}),
        ...(chave ? { idempotency: { key: chave, replayed: false } } : {}),
        // Em nome de quem a API respondeu (X-B2C-Identity). Quem monta algo
        // por pessoa (relatório do Telegram) confere isto antes de entregar.
        ...(auth.delegacao ? { onBehalfOf: { identityId: auth.delegacao.identityId } } : {}),
      });
      if (reserva?.tipo === "nova") {
        // A operação JÁ aconteceu: se guardar o resultado falhar, a chave fica
        // "em andamento" (a repetição recebe 409) — nunca é liberada, porque
        // liberar faria a repetição executar de novo.
        try {
          await concluirChave(reserva.id, status, sucesso);
        } catch (e) {
          console.error(`[api] ${requestId} falha ao guardar o resultado da Idempotency-Key`, e);
        }
        reserva = null;
      }
      await trilha({ ownerId: auth.ownerId, serviceAccountId: auth.serviceAccountId, result: "SUCCESS", httpStatus: status, audit: out.audit });
      return responder(status, sucesso, requestId, chave ? { "Idempotent-Replayed": "false" } : {});
    } catch (e) {
      let err: ApiError;
      if (e instanceof ApiError) err = e;
      else if (e instanceof DomainNotFoundError) err = new ApiError(404, "not_found", e.message);
      else if (e instanceof z.ZodError) {
        // Validação DENTRO do domínio (regra de negócio sobre o pedido).
        err = new ApiError(422, "unprocessable", "Pedido recusado pela regra de negócio.", undefined,
          e.issues.map((i) => ({ field: i.path.join(".") || null, message: i.message })));
      } else {
        // Nada do erro interno vai para a resposta; o requestId liga ao log.
        console.error(`[api] ${requestId} ${new URL(req.url).pathname}`, e);
        err = new ApiError(500, "internal_error", "Erro interno. Informe o requestId ao suporte.");
      }
      const corpoErro = corpoDeErro(err, requestId);
      if (reserva?.tipo === "nova") {
        try {
          if (guardavel(err.status)) await concluirChave(reserva.id, err.status, corpoErro);
          else await liberarChave(reserva.id);
        } catch (e2) {
          console.error(`[api] ${requestId} falha ao fechar a Idempotency-Key`, e2);
        }
      }
      if (auth) {
        await trilha({
          ownerId: auth.ownerId, serviceAccountId: auth.serviceAccountId,
          result: err.status === 401 || err.status === 403 || err.status === 429 || err.code === "identity_not_found" ? "DENIED" : "ERROR",
          httpStatus: err.status, errorCode: err.code,
        });
      }
      return responder(err.status, corpoErro, requestId, cabecalhosDeErro(err));
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

/**
 * Instante → ISO. Aceita também TEXTO: resultados de `ownerCached` voltam
 * serializados em cache hit (Date vira string) — sem isto, a 2ª chamada de
 * uma rota que lê dado em cache (ex.: /routine/daily) quebrava com 500.
 */
export function instante(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
}
