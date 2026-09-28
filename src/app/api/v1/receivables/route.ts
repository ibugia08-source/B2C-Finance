import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { competenciaSchema, dataSchema, defineEndpoint, idSchema, metaDePaginacao, paginacao } from "@/lib/api/http";
import { competenciaAtual, intervaloDeDias } from "@/lib/api/v1/common";
import { listarRecebiveisApi, OPEN_GROUP, RECEIVABLE_STATUSES, type ReceivableStatus } from "@/lib/api/v1/receivables";

/**
 * GET /api/v1/receivables — cobranças. Janela: `dateFrom`+`dateTo` (vencimento)
 * OU `competence` (padrão: a competência atual). `status` aceita vários,
 * separados por vírgula, e o atalho `open` (tudo que ainda tem saldo).
 */
export const dynamic = "force-dynamic";

const statusLista = z
  .string()
  .transform((v) => v.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))
  .pipe(z.array(z.enum([...RECEIVABLE_STATUSES, "OPEN"])).min(1))
  .transform((l) => [...new Set(l.flatMap((s) => (s === "OPEN" ? OPEN_GROUP : [s as ReceivableStatus])))]);

const Query = z
  .object({
    status: statusLista.optional(),
    dateFrom: dataSchema.optional(),
    dateTo: dataSchema.optional(),
    competence: competenciaSchema.optional(),
    clientId: idSchema.optional(),
    ...paginacao,
  })
  .strict();

export const GET = defineEndpoint({ action: "receivables.list", scope: "receivables.read", query: Query }, async ({ query }) => {
  const porData = query.dateFrom || query.dateTo;
  if (porData && !(query.dateFrom && query.dateTo)) {
    throw new ApiError(400, "validation_error", "Informe dateFrom e dateTo juntos.");
  }
  if (porData && query.competence) {
    throw new ApiError(400, "validation_error", "Use dateFrom/dateTo ou competence, não os dois.");
  }
  const competence = query.competence ?? competenciaAtual();
  const [y, m] = competence.split("-").map(Number);
  const r = await listarRecebiveisApi({
    where: {
      ...(porData ? { dueDate: intervaloDeDias(query.dateFrom!, query.dateTo!) } : { competenceYear: y, competenceMonth: m }),
      ...(query.clientId ? { clientId: query.clientId } : {}),
    },
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  });
  return {
    data: r.itens,
    meta: {
      ...metaDePaginacao(query.page, query.pageSize, r.total),
      window: porData ? { dateFrom: query.dateFrom, dateTo: query.dateTo } : { competence },
      totals: r.totals,
      ...(r.truncated ? { truncated: true } : {}),
    },
  };
});
