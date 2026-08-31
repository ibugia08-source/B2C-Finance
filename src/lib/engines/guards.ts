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
 * ESTADO ATUAL: sempre permite. O ClosingPeriod nasce na F2.1 e é ele que
 * dá a resposta de verdade; até lá, competência nenhuma está fechada,
 * então "permitir" é a resposta CORRETA, não um atalho.
 *
 * A guarda já existe e já é chamada de propósito: quando a F2.1 chegar,
 * a regra entra AQUI, num lugar só, e passa a valer para todos os motores
 * de uma vez. Se ela nascesse junto com o ClosingPeriod, teria de ser
 * costurada em cada motor depois — e é assim que se esquece de um.
 */
export async function guardPeriod(
  _eventType: string,
  _competence: Competence
): Promise<Guard> {
  return OK;
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
