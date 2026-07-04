import { createHash } from "crypto";

function sha1(key: string): string {
  return createHash("sha1").update(key).digest("hex");
}

/** Normalização de descrição usada nas chaves (acentos, espaços, caixa). */
export function normalizeDescriptionKey(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function dayOf(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Hash LEGADO (v1) — mantido apenas para detectar duplicatas de importações
 * feitas antes da mudança de esquema. Não usar para novos registros.
 */
export function transactionHash(input: {
  date: Date | string;
  description: string;
  amount: number;
  cardId?: string | null;
  accountId?: string | null;
}) {
  const desc = (input.description || "").trim().toUpperCase();
  const key = `${dayOf(input.date)}|${desc}|${cents(input.amount)}|${input.cardId ?? ""}|${input.accountId ?? ""}`;
  return sha1(key);
}

/**
 * Hash v2 de linha importada — escopado à fatura de referência e com índice de
 * ocorrência dentro do arquivo:
 *  - reimportar a MESMA fatura é idempotente (mesmos hashes);
 *  - duas compras legítimas idênticas no mesmo dia NÃO colidem (occurrence 0/1);
 *  - a parcela seguinte da mesma compra em outra fatura gera hash diferente.
 */
export function importedLineHash(input: {
  date: Date | string;
  description: string;
  amount: number;
  cardId?: string | null;
  accountId?: string | null;
  /** "YYYY-MM" da fatura âncora (vazio p/ extrato de conta sem fatura) */
  referenceKey?: string | null;
  installmentNumber?: number | null;
  installmentTotal?: number | null;
  /** nº de linhas idênticas anteriores no mesmo arquivo (0 para a primeira) */
  occurrence: number;
}) {
  const key = [
    "v2",
    input.referenceKey ?? "",
    dayOf(input.date),
    normalizeDescriptionKey(input.description),
    cents(input.amount),
    input.cardId ?? "",
    input.accountId ?? "",
    input.installmentNumber ?? "",
    input.installmentTotal ?? "",
    input.occurrence,
  ].join("|");
  return sha1(key);
}

/**
 * Chave do grupo de parcelamento — identifica a MESMA compra parcelada ao
 * longo dos meses: conta/cartão + descrição normalizada + valor da parcela +
 * total de parcelas. O número da parcela NÃO entra (varia por mês).
 */
export function installmentGroupKeyFor(input: {
  cardId?: string | null;
  description: string;
  amount: number;
  installmentTotal: number;
}): string {
  const key = [
    "grp",
    input.cardId ?? "",
    normalizeDescriptionKey(input.description),
    cents(input.amount),
    input.installmentTotal,
  ].join("|");
  return sha1(key);
}
