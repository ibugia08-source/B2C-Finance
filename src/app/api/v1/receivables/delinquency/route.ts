import { z } from "zod";
import { competenciaSchema, defineEndpoint, metaDePaginacao, paginacao } from "@/lib/api/http";
import { posicaoDeInadimplenciaApi } from "@/lib/api/v1/delinquency";

/**
 * GET /api/v1/receivables/delinquency — QUEM ESTÁ INADIMPLENTE AGORA.
 *
 * A mesma lista da tela Inadimplência: um registro por cliente com saldo
 * vencido, quantidade de cobranças e dias de atraso, de TODAS as competências
 * (sem `competence`) ou só das cobranças de uma competência (com
 * `competence`). Totais (clientes, valor, cobranças) do filtro inteiro.
 *
 * Não confundir com `GET /receivables?status=DELINQUENT` (só as escaladas
 * manualmente, numa janela) nem com a fila de cobrança da Rotina do dia.
 *
 * Scope `receivables.read`; em nome de uma pessoa, ela precisa também de
 * "Ver inadimplência" (`recebimentos.ver_inadimplencia`), como na tela.
 */
export const dynamic = "force-dynamic";

const Query = z.object({ competence: competenciaSchema.optional(), ...paginacao }).strict();

export const GET = defineEndpoint(
  { action: "receivables.delinquency", scope: "receivables.read", permissaoDoUsuario: "recebimentos.ver_inadimplencia", query: Query },
  async ({ query }) => {
    const r = await posicaoDeInadimplenciaApi({ competence: query.competence, page: query.page, pageSize: query.pageSize });
    return {
      data: r.itens,
      meta: { ...metaDePaginacao(query.page, query.pageSize, r.total), ...r.meta },
      audit: { metadata: { competencia: query.competence ?? null, clientes: r.total } },
    };
  }
);
