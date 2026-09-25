import { calendarParts } from "@/lib/renewal-expectation";

/**
 * "HOJE" CIVIL — fonte única (auditoria 25/09/2026).
 *
 * Datas civis (vencimento, data do pagamento, data da despesa) são gravadas à
 * meia-noite e lidas pelo dia em UTC. O "hoje" do negócio, porém, é o dia do
 * calendário da Bahia. Antes, cada action fazia `new Date(); setHours(0)` —
 * no servidor (Vercel, UTC) isso é o dia UTC, que depois das 21h da Bahia já
 * é AMANHÃ: o que vencia hoje virava OVERDUE e o mês corrente virava antes da
 * hora no último dia.
 *
 * DUAS FORMAS, dois usos:
 *  · `hojeCivil()` — PARA COMPARAR: o dia da Bahia às 00:00 UTC. `dueDate <
 *    hojeCivil()` (= vencida) acerta tanto para datas gravadas a 00:00Z
 *    (servidor) quanto a 03:00Z (máquina na Bahia).
 *  · `hojeCivilParaGravar()` — PARA GRAVAR (paidAt, vencimento padrão): o
 *    mesmo dia no formato que `parseDateBR` grava, meia-noite do processo
 *    (00:00Z no servidor — idêntico ao anterior —, 03:00Z na Bahia). Assim o
 *    registro cai nos mesmos intervalos de mês (`monthRange`, em hora local)
 *    que as datas digitadas. As partes UTC dão o dia certo nos dois casos.
 */
export function hojeCivil(agora: Date = new Date()): Date {
  const p = calendarParts(agora);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

/** Hoje (dia da Bahia) no formato de gravação de data civil (ver acima). */
export function hojeCivilParaGravar(agora: Date = new Date()): Date {
  const p = calendarParts(agora);
  return new Date(p.year, p.month - 1, p.day);
}

/** Mês corrente (1-12) no calendário da Bahia. */
export function mesCivilAtual(agora: Date = new Date()): { year: number; month: number } {
  const p = calendarParts(agora);
  return { year: p.year, month: p.month };
}

/** Índice absoluto (ano*12 + mês0) do mês de uma DATA CIVIL (partes UTC). */
export function chaveMesCivil(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Número do dia de uma DATA CIVIL (partes UTC) — para comparar dias sem hora. */
export function chaveDiaCivil(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
