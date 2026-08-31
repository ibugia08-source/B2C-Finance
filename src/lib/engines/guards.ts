import type { Competence } from "@/lib/competence";

/**
 * GUARDAS DO PIPELINE (F1.5 · ref. 03 §4.1).
 *
 *   settleBilling(): permission -> period guard -> idempotency guard -> ...
 *
 * Cada guarda devolve `{ ok:false, error }` em vez de lançar: erro de
 * REGRA vira mensagem para o usuário, não 500. Exceção fica reservada a
 * erro de programação.
 */
export type Guard = { ok: true } | { ok: false; error: string };

export const OK: Guard = { ok: true };

/**
 * 1. Permissão — a primeira pergunta, sempre.
 *
 * Import PREGUIÇOSO: a cadeia de permissão chega em getCurrentUser, que
 * usa o cache() do React e só existe dentro de uma request. Importando no
 * topo, qualquer módulo que apenas MENCIONE uma guarda quebraria em teste
 * e em job — inclusive os motores inteiros.
 */
export async function guardPermission(permission: string): Promise<Guard> {
  const { tryPermission } = await import("@/lib/auth/viewer");
  return (await tryPermission(permission))
    ? OK
    : { ok: false, error: "Você não tem permissão para esta ação." };
}

/**
 * 2. Período — a competência aceita o evento?
 *
 * LIGADA na F2.1. Até aqui devolvia sempre OK, porque competência nenhuma
 * podia estar fechada — a guarda já existia e já era chamada de propósito,
 * justamente para que a regra entrasse num lugar só e passasse a valer para
 * todos os motores de uma vez. Foi o que aconteceu: nenhum motor mudou.
 *
 * `competence` é a competência em que o evento vai POSTAR, não a de origem
 * do documento. Para um recebimento é o MÊS DO CAIXA — é essa distinção que
 * faz 01 §5.6 funcionar: pagar em outubro uma cobrança de agosto fechado é
 * normal e continua permitido.
 *
 * Import preguiçoso pelo mesmo motivo do de cima: a cadeia passa por
 * currentWorkspaceId e não pode quebrar em job nem em teste.
 */
export async function guardPeriod(
  eventType: string,
  competence: Competence
): Promise<Guard> {
  try {
    const { assertPeriodAllows } = await import("@/lib/services/closing-period");
    return await assertPeriodAllows(eventType, competence);
  } catch {
    // Sem workspace (script de manutenção, migração inicial), não há
    // fechamento possível — e travar a operação por não conseguir LER o
    // estado do período seria pior que o problema que a guarda evita.
    return OK;
  }
}

/**
 * 3. Idempotência — este fato externo já entrou?
 *
 * Só se aplica a pagamento de ORIGEM EXTERNA (webhook de gateway, OFX).
 * A trava real está no banco, nas uniques de externalSource+externalId e
 * idempotencyKey (F0.9); esta checagem existe para o segundo webhook
 * receber uma resposta limpa em vez de um erro de constraint.
 */
export async function guardIdempotency(
  buscar: () => Promise<{ id: string } | null>,
  chave: string | null | undefined
): Promise<Guard & { jaProcessado?: string }> {
  if (!chave) return OK;
  const existente = await buscar();
  return existente
    ? { ok: false, error: "Este pagamento já foi registrado.", jaProcessado: existente.id }
    : OK;
}
