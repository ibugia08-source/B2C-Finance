import { MONTHS_PT, WORKSPACE_TIMEZONE } from "@/lib/format";
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
 * Fuso do workspace (01 §3.4). Declarado em lib/format — que é onde os
 * formatadores de instante precisam dele — e reexportado aqui para os ~20
 * módulos que já importavam daqui.
 */
export { WORKSPACE_TIMEZONE };
const MESES = MONTHS_PT;

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

/**
 * Resolve o `?mes=` das páginas: bem formado → ele; senão → a competência da
 * data padrão (hoje, ou o mês anterior no Fechamento). Substitui o bloco de
 * regex + split copiado que vivia em 9 pages.
 */
export function competenciaDaUrl(
  param: string | null | undefined,
  padrao: Date = new Date()
): { competence: Competence; ano: number; mes: number } {
  const p = typeof param === "string" ? parseCompetence(param) : null;
  const ano = p?.year ?? padrao.getFullYear();
  const mes = p?.month ?? padrao.getMonth() + 1;
  return { competence: toCompetence(ano, mes), ano, mes };
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

/**
 * Competência de uma DATA CIVIL (vencimento, data da despesa, data do
 * pagamento) — lida pelas partes UTC, como `formatDateBR` exibe.
 *
 * `competenceOf` é para INSTANTES. Aplicada a uma data civil gravada à
 * meia-noite UTC (o que o servidor grava), ela volta 3 horas no fuso da
 * Bahia e cai no dia ANTERIOR: a despesa do dia 1º era conferida contra a
 * guarda de período do mês anterior.
 */
export function competenceOfCivil(date: Date): Competence {
  return toCompetence(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/**
 * Competências (YYYY-MM) cobertas por um período [start, end) montado com
 * construtores LOCAIS (`new Date(a, m, 1)`, como lib/period faz): os meses
 * saem das partes locais do início e do último instante. Passar o cursor
 * por `competenceOf` (fuso da Bahia) no servidor UTC devolvia o mês
 * ANTERIOR — o relatório de setembro calculava agosto.
 */
export function competenciasDoPeriodo(start: Date, end: Date): Competence[] {
  const fim = new Date(end.getTime() - 1);
  const out: Competence[] = [];
  let y = start.getFullYear();
  let m = start.getMonth() + 1;
  const fimKey = fim.getFullYear() * 12 + fim.getMonth();
  while (y * 12 + (m - 1) <= fimKey && out.length < 600) {
    out.push(toCompetence(y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.length > 0 ? out : [toCompetence(start.getFullYear(), start.getMonth() + 1)];
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

// ============================================================================
// DATAS CIVIS DA COMPETÊNCIA (status temporal de clientes, 26/09/2026)
//
// Datas de vigência são DIAS DO CALENDÁRIO, sem hora nem fuso, como a string
// `YYYY-MM-DD`. Trabalhar com a string — e não com Date — é o que garante que
// 01/10/2026 nunca vire 30/09/2026 numa conversão UTC ↔ Bahia.
// ============================================================================

/** Dia civil `YYYY-MM-DD`. */
export type DateKey = string;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Competência de uma data civil (`"2026-10-15"` → `"2026-10"`) ou de (ano, mês). */
export function getCompetenceKey(value: DateKey | Date | number, month?: number): Competence {
  if (typeof value === "number") return toCompetence(value, month ?? 1);
  if (value instanceof Date) return toCompetence(value.getUTCFullYear(), value.getUTCMonth() + 1);
  return value.slice(0, 7);
}

/** Primeiro dia da competência: `"2026-09"` → `"2026-09-01"`. */
export function getStartOfCompetence(competence: Competence): DateKey {
  if (!parseCompetence(competence)) throw new RangeError(`Competência inválida: ${competence}`);
  return `${competence}-01`;
}

/** Último dia da competência (28, 29, 30 ou 31): `"2024-02"` → `"2024-02-29"`. */
export function getEndOfCompetence(competence: Competence): DateKey {
  const p = parseCompetence(competence);
  if (!p) throw new RangeError(`Competência inválida: ${competence}`);
  const last = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return `${competence}-${String(last).padStart(2, "0")}`;
}

export function getPreviousCompetence(competence: Competence): Competence {
  return addMonths(competence, -1);
}

export function getNextCompetence(competence: Competence): Competence {
  return addMonths(competence, 1);
}

/** É um dia civil válido? (`"2026-02-30"` não é.) */
export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string") return false;
  const m = value.match(DAY_RE);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Soma dias a um dia civil (negativo subtrai). */
export function addDays(day: DateKey, days: number): DateKey {
  const m = day.match(DAY_RE);
  if (!m) throw new RangeError(`Data inválida: ${day}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

/** Dia civil → Date à meia-noite UTC (o formato das colunas @db.Date). */
export function dateKeyToDate(day: DateKey): Date {
  if (!isDateKey(day)) throw new RangeError(`Data inválida: ${day}`);
  return new Date(`${day}T00:00:00.000Z`);
}

/** Coluna @db.Date (meia-noite UTC) → dia civil. */
export function dateToDateKey(d: Date): DateKey {
  return d.toISOString().slice(0, 10);
}

/** "Hoje" do negócio (calendário da Bahia) como dia civil. */
export function todayKey(now: Date = new Date()): DateKey {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: WORKSPACE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const v = (t: string) => partes.find((p) => p.type === t)!.value;
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/**
 * Dia civil de um timestamptz na convenção do sistema — a MESMA regra de
 * `b2c_civil_date` no banco: meia-noite UTC em ponto é data civil gravada
 * (lê-se o dia UTC); qualquer outra hora é um instante (lê-se na Bahia).
 */
export function civilDateKeyOf(ts: Date): DateKey {
  if (ts.getUTCHours() === 0 && ts.getUTCMinutes() === 0 && ts.getUTCSeconds() === 0 && ts.getUTCMilliseconds() === 0)
    return ts.toISOString().slice(0, 10);
  return todayKey(ts);
}

/** `"2026-10-01"` → `"01/10/2026"`. */
export function formatDateKey(day: DateKey): string {
  const m = day.match(DAY_RE);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day;
}

/**
 * Data de referência da competência para a CARTEIRA: o encerramento do mês
 * (último dia). Na competência em curso, HOJE — o fim do mês ainda não
 * aconteceu, e uma mudança programada para o dia 20 não pode aparecer no
 * número de hoje. Competência futura: o último dia (é projeção).
 */
export function competenceReferenceDate(competence: Competence, today: DateKey = todayKey()): DateKey {
  const atual = today.slice(0, 7);
  if (competence === atual) return today;
  return getEndOfCompetence(competence);
}
