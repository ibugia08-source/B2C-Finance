import { z } from "zod";
import { defineEndpoint } from "@/lib/api/http";
import { LIMITE_POR_USUARIO } from "@/lib/api/agent/catalog";
import { ConfirmacaoBody, confirmarAcao, mensagemDoResultado, serializarAcao } from "@/lib/api/agent/pending-actions";

/**
 * POST /api/v1/agent/pending-actions/:id/confirm — o USUÁRIO confirmou
 * ("SIM 4821"). Confere usuário, vínculo, código, validade e estado; executa
 * o payload GUARDADO pela rota de escrita oficial com
 * Idempotency-Key = wa:<messageId>:<actionId>. A confirmação não leva corpo
 * da ação: não há como trocar o que será executado.
 *
 * 200 = a ação foi despachada (data.status EXECUTED ou FAILED, com a
 * mensagem pronta para o WhatsApp). 4xx = a confirmação não vale.
 */
export const dynamic = "force-dynamic";

const Params = z.object({ id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Id inválido.") });

export const POST = defineEndpoint(
  { action: "agent_actions.confirm", scope: "agent_actions.manage", params: Params, body: ConfirmacaoBody, limitePorUsuario: LIMITE_POR_USUARIO.decidir },
  async ({ req, auth, ctx, params, body, requestId }) => {
    const r = await confirmarAcao({
      req, auth, ctx, id: params.id, body, requestId,
      idempotencyKey: req.headers.get("idempotency-key")?.trim() || null,
    });
    const a = r.acao;
    return {
      data: { ...serializarAcao(a), message: mensagemDoResultado(a), replayed: r.replayed },
      audit: {
        entityType: "PendingAction",
        entityId: a.id,
        label: (a.summary as any)?.label ?? undefined,
        amount: (a.summary as any)?.amount ?? null,
        metadata: { operation: a.operation, status: a.status, idempotencyKey: a.idempotencyKey, replayed: r.replayed },
      },
    };
  }
);
