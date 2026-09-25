import { WORKSPACE_TIMEZONE } from "@/lib/format";

/**
 * EXPECTATIVA DE RENOVAÇÃO — regra pura (25/09/2026), sem banco.
 *
 * A regra do dono: **data de entrada + prazo do contrato = data de
 * expectativa de renovação.** Depois de cada ciclo, a próxima expectativa é
 * a anterior + prazo. Uma data que já passou sem desfecho, no momento do
 * CÁLCULO (cadastro, mudança de prazo, importação), anda em ciclos até o mês
 * corrente: o cliente segue ativo, então aquele ciclo aconteceu.
 *
 * DOIS TIPOS DE DATA, duas leituras:
 *  · DATA CIVIL (entrada, expectativa): um dia do calendário, sem hora. O
 *    sistema grava à meia-noite — 03:00 UTC quando criada no fuso da Bahia,
 *    00:00 UTC quando criada no servidor (Vercel, em UTC) — e a exibe pelo
 *    dia em UTC (formatDateBR). Lida no fuso da Bahia, a de 00:00 UTC vira o
 *    dia ANTERIOR, e a expectativa de 01/03 cairia em fevereiro. Por isso
 *    data civil é lida por `civilParts` (UTC).
 *  · INSTANTE (agora, registrado em): lido no calendário do workspace
 *    (`calendarParts`), que é o "hoje" do negócio.
 * Toda data civil gerada aqui fica ao MEIO-DIA da Bahia (15:00 UTC): as duas
 * leituras concordam e nenhuma borda de mês a desloca.
 */

export type YearMonth = { year: number; month: number }; // month 1-12

/** Partes de calendário (ano, mês 1-12, dia) de um instante, no fuso do workspace. */
export function calendarParts(d: Date, timeZone = WORKSPACE_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Dia de calendário de uma DATA CIVIL (entrada, expectativa) — lido em UTC. */
export function civilParts(d: Date) {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Deslocamento (ms) do fuso num instante: horário de parede − UTC. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return wall - instant;
}

/** Instante de `hh:00` do dia (ano, mês 1-12, dia) no fuso do workspace. */
export function zonedDate(year: number, month: number, day: number, hour = 12, timeZone = WORKSPACE_TIMEZONE): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  return new Date(guess - offsetAt(guess, timeZone));
}

/** Último dia do mês (1-12). */
export function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Índice absoluto de mês — para comparar e subtrair meses sem Date. */
export function monthIndex(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

export function fromMonthIndex(i: number): YearMonth {
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

/** "YYYY-MM". */
export function toCompetenceKey(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

/** "YYYY-MM" → {year, month}; inválido → null. */
export function parseCompetenceKey(v: string | null | undefined): YearMonth | null {
  const m = typeof v === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v.trim()) : null;
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** Competência (YYYY-MM) de um instante, no calendário do workspace. */
export function competenceKeyOf(d: Date): string {
  const p = calendarParts(d);
  return toCompetenceKey(p);
}

/** Competência (YYYY-MM) de uma DATA CIVIL (a expectativa, a entrada). */
export function civilCompetenceKey(d: Date): string {
  return toCompetenceKey(civilParts(d));
}

/** Uma data civil qualquer, normalizada ao meio-dia da Bahia do mesmo dia. */
export function civilNoon(d: Date): Date {
  const p = civilParts(d);
  return zonedDate(p.year, p.month, p.day);
}

/** Hoje, como data civil (dia do calendário da Bahia, ao meio-dia). */
export function civilToday(ref: Date = new Date()): Date {
  const p = calendarParts(ref);
  return zonedDate(p.year, p.month, p.day);
}

/** Soma meses a uma DATA CIVIL, com o dia limitado ao fim do mês. */
export function addCalendarMonths(d: Date, months: number): Date {
  const p = civilParts(d);
  const target = fromMonthIndex(monthIndex(p) + months);
  const day = Math.min(p.day, lastDayOf(target.year, target.month));
  return zonedDate(target.year, target.month, day);
}

/**
 * Leva `date` para frente, em passos de `period` meses, até cair no mês de
 * `ref` ou depois. Nunca volta.
 */
export function rollForward(date: Date, period: number, ref: Date = new Date()): Date {
  if (!(period >= 1)) return date;
  const atraso = monthIndex(calendarParts(ref)) - monthIndex(civilParts(date));
  if (atraso <= 0) return date;
  const passos = Math.ceil(atraso / period);
  return addCalendarMonths(date, passos * period);
}

/**
 * Expectativa a partir da BASE: entrada + prazo, e ciclos de `prazo` até o
 * mês corrente. Sem entrada ou sem prazo, não há expectativa (null).
 */
export function expectationFromBase(
  startedAt: Date | null | undefined,
  contractMonths: number | null | undefined,
  ref: Date = new Date()
): Date | null {
  if (!startedAt || !contractMonths || contractMonths < 1) return null;
  return rollForward(addCalendarMonths(startedAt, contractMonths), contractMonths, ref);
}

/**
 * Data da expectativa ao AGENDAR À MÃO para um mês: o dia do ciclo do
 * cliente (dia da entrada), limitado ao fim do mês; sem entrada, dia 1.
 */
export function expectationInMonth(ym: YearMonth, startedAt?: Date | null): Date {
  const dia = startedAt ? civilParts(startedAt).day : 1;
  return zonedDate(ym.year, ym.month, Math.min(dia, lastDayOf(ym.year, ym.month)));
}

/** [início, fim) de um mês no fuso do workspace — para filtrar por período. */
export function monthBounds(ym: YearMonth): { start: Date; end: Date } {
  const next = fromMonthIndex(monthIndex(ym) + 1);
  return { start: zonedDate(ym.year, ym.month, 1, 0), end: zonedDate(next.year, next.month, 1, 0) };
}

/** Mês corrente no calendário do workspace. */
export function currentYearMonth(ref: Date = new Date()): YearMonth {
  const p = calendarParts(ref);
  return { year: p.year, month: p.month };
}

/** Lista de competências consecutivas: `from` e mais `count − 1` meses. */
export function monthRange(from: YearMonth, count: number): YearMonth[] {
  const base = monthIndex(from);
  return Array.from({ length: count }, (_, i) => fromMonthIndex(base + i));
}

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** "2026-09" → "Set/2026"; inválido → o próprio texto. */
export function competenceShortLabel(key: string | null | undefined): string {
  const ym = parseCompetenceKey(key);
  return ym ? `${MESES_CURTOS[ym.month - 1]}/${ym.year}` : String(key ?? "");
}

/**
 * Opções de mês/ano para escolher a expectativa (seletores da carteira, do
 * agendamento e dos filtros): do mês anterior até 24 meses à frente. O valor
 * atual, se estiver fora da janela, entra também — para o select nunca
 * esconder o que está gravado.
 */
export function renewalCompetenceOptions(
  current?: string | null,
  opts: { back?: number; ahead?: number; ref?: Date } = {}
): { value: string; label: string }[] {
  const back = opts.back ?? 1;
  const ahead = opts.ahead ?? 24;
  const base = monthIndex(currentYearMonth(opts.ref));
  const keys = Array.from({ length: back + ahead + 1 }, (_, i) =>
    toCompetenceKey(fromMonthIndex(base - back + i))
  );
  if (current && parseCompetenceKey(current) && !keys.includes(current)) {
    keys.push(current);
    keys.sort();
  }
  return keys.map((k) => ({ value: k, label: competenceShortLabel(k) }));
}

/**
 * PRAZO INDETERMINADO (25/09/2026): valor do campo "prazo" nos formulários e
 * selects. O cliente não tem término — fica ativo até ser dado como perdido —
 * e não entra em Renovações sozinho: só quando agendado à mão.
 */
export const PRAZO_INDETERMINADO = "indeterminado";

/** Rótulo único do prazo do contrato em toda a plataforma. */
export function contractTermLabel(months: number | null | undefined, indefinite?: boolean | null): string {
  if (indefinite) return "Indeterminado";
  if (months && months > 0) return `${months} ${months === 1 ? "mês" : "meses"}`;
  return "—";
}
