import { defineEndpoint } from "@/lib/api/http";
import { LIMITE_POR_USUARIO } from "@/lib/api/agent/catalog";
import { ListaQuery, PropostaBody, listarAcoes, proporAcao, serializarAcao } from "@/lib/api/agent/pending-actions";

/**
 * AÇÕES DO AGENTE COM CONFIRMAÇÃO (docs/N8N_AGENT_WRITE_ACTIONS.md).
 *
 * POST /api/v1/agent/pending-actions — o agente PROPÕE uma escrita. Nada é
 * gravado no negócio: a API valida o corpo com o schema da rota de escrita,
 * lê o estado atual, monta o preview e guarda a ação com um código. Exige
 * X-B2C-Identity (a ação é sempre de um usuário) e o scope da operação nos
 * scopes efetivos dele. Operação bloqueada = 403 operation_blocked.
 *
 * GET — as ações do usuário do vínculo (ex.: a pendente desta mensagem).
 */
export const dynamic = "force-dynamic";

export const POST = defineEndpoint(
  { action: "agent_actions.propose", scope: "agent_actions.manage", body: PropostaBody, limitePorUsuario: LIMITE_POR_USUARIO.propor },
  async ({ req, auth, ctx, body }) => {
    const origem = req.headers.get("x-b2c-message-id")?.trim().slice(0, 200) || null;
    const a = await proporAcao({ auth, ctx, body, sourceMessageId: origem });
    return {
      status: 201,
      data: serializarAcao(a),
      audit: {
        entityType: "PendingAction",
        entityId: a.id,
        label: (a.summary as any)?.label ?? undefined,
        amount: (a.summary as any)?.amount ?? null,
        metadata: { operation: a.operation, targetId: a.targetId },
      },
    };
  }
);

export const GET = defineEndpoint(
  { action: "agent_actions.list", scope: "agent_actions.manage", query: ListaQuery },
  async ({ auth, query }) => {
    const itens = await listarAcoes(auth, query);
    return { data: itens.map(serializarAcao) };
  }
);
