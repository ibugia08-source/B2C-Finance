import { concluirAcaoDaRotina, montarRotinaDoDia } from "@/lib/services/daily-routine";
import type { DomainContext } from "@/lib/engines/domain";
import { ApiError } from "../auth";

/**
 * CONCLUIR AÇÃO DA ROTINA pela API. A ação precisa estar na rotina de HOJE
 * desta conta (a mesma lista de GET /routine/daily) — chave inventada ou de
 * outro dia dá 404, em vez de gravar um estado que ninguém vai ler.
 */
export async function concluirAcaoApi(ctx: DomainContext, chave: string) {
  const rotina = await montarRotinaDoDia(ctx);
  const acao = rotina.acoes.find((a) => a.key === chave);
  if (!acao) throw new ApiError(404, "not_found", "Ação não encontrada na rotina de hoje.");
  const r = await concluirAcaoDaRotina(ctx, chave, true);
  if (!r.ok) throw new ApiError(403, "insufficient_scope", r.error);
  return { key: acao.key, text: acao.text, priority: acao.priority, done: true, alreadyDone: r.alreadyInState };
}
