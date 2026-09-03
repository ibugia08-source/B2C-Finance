/**
 * COMPETÊNCIA — dimensão temporal do resultado (ref. 01 §3.15).
 *
 * A competência é uma DIMENSÃO EXPLÍCITA no formato `YYYY-MM`, nunca deduzida
 * de `createdAt`. Este módulo é o ponto único de formatação, leitura e
 * comparação — nenhum serviço deve montar a string na mão.
 *
 * Convivência com o v1: as tabelas ainda guardam `competenceMonth`/
 * `competenceYear` (ou `month`/`year`) como inteiros. A coluna `competence`
 * existe ao lado, mantida por GATILHO no banco — as duas nunca divergem,
 * venha a escrita de onde vier (app, script ou SQL). A partir da Fase 1 as
 * consultas migram para a coluna nova.
 *
 * Datas semânticas distintas (01 §3.15): competence (resultado), dueDate
 * (vencimento), paidAt (caixa), postedAt (ledger), closedAt (fechamento).
 * Não confundir uma com a outra.
 */

/** Competência no formato canônico `YYYY-MM`. */
export type Competence = string;

const RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Fuso do workspace (01 §3.4). Enquanto houver um único workspace, é
 * constante; a partir da Fase 1 vem de Workspace.timezone.
 */
export const WORKSPACE_TIMEZONE = "America/Bahia";
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** `(2026, 3)` → `"2026-03"`. Mês 1-12. */
export function toCompetence(year: number, month: number): Competence {
  if (!Number.isInteger(year) || year < 1900 || year > 2999)
    throw new RangeError(`Ano inválido para competência: ${year}`);
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new RangeError(`Mês inválido para competência: ${month}`);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** `"2026-03"` → `{ year: 2026, month: 3 }`; formato inválido → null. */
export function parseCompetence(
  value: string | null | undefined
): { year: number; month: number } | null {
  const m = typeof value === "string" ? value.match(RE) : null;
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** É uma competência bem formada? */
export function isCompetence(value: unknown): value is Competence {
  return typeof value === "string" && RE.test(value);
}

/**
 * Competência de uma data, no fuso do workspace (01 §3.4/§3.15).
 * Uma cobrança de 31/01 às 23h em Salvador é competência 2026-01, não 2026-02.
 */
export function competenceOf(date: Date, timeZone: string = WORKSPACE_TIMEZONE): Competence {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = partes.find((p) => p.type === "year")!.value;
  const month = partes.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

/** Soma (ou subtrai) meses: `addMonths("2026-11", 3)` → `"2027-02"`. */
export function addMonths(competence: Competence, months: number): Competence {
  const p = parseCompetence(competence);
  if (!p) throw new RangeError(`Competência inválida: ${competence}`);
  const total = p.year * 12 + (p.month - 1) + months;
  return toCompetence(Math.floor(total / 12), (total % 12) + 1);
}

/** Distância em meses (b − a): `diffMonths("2026-01","2026-04")` → 3. */
export function diffMonths(a: Competence, b: Competence): number {
  const pa = parseCompetence(a);
  const pb = parseCompetence(b);
  if (!pa || !pb) throw new RangeError(`Competência inválida: ${a} / ${b}`);
  return (pb.year * 12 + pb.month) - (pa.year * 12 + pa.month);
}

/** Ordenação: negativo, zero ou positivo (a string YYYY-MM já ordena bem). */
export function compareCompetence(a: Competence, b: Competence): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rótulo para a interface: `"2026-03"` → `"Março de 2026"`. */
export function competenceLabel(competence: Competence): string {
  const p = parseCompetence(competence);
  if (!p) return competence;
  return `${MESES[p.month - 1]} de ${p.year}`;
}

/** Rótulo curto: `"2026-03"` → `"03/2026"`. */
export function competenceShort(competence: Competence): string {
  const p = parseCompetence(competence);
  if (!p) return competence;
  return `${String(p.month).padStart(2, "0")}/${p.year}`;
}
