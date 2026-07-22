/**
 * Conversor canônico Decimal/unknown → number (null/undefined → 0).
 * Substitui as N cópias locais de `const n = (v) => ...` nos services —
 * novas implementações devem importar DAQUI.
 */
export const toNumber = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Normaliza campo de FormData: trim; vazio/ausente → null.
 * Fonte única das cópias locais de `clean()` nas server actions.
 */
export function clean(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}

/** Meses PT-BR — fonte única (substitui os arrays locais espalhados). */
export const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
] as const;
export const MONTHS_PT_SHORT = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
] as const;

export const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

export function formatBRL(value: number | null | undefined): string {
  if (value == null || isNaN(Number(value))) return "R$ 0,00";
  return BRL.format(Number(value));
}

/**
 * Moeda compacta para eixos de gráfico: R$ 1,5 mil / R$ 12 mil / R$ 1,2 mi.
 * Mantém legibilidade sem poluir o eixo Y com valores longos.
 */
export function formatBRLShort(value: number | null | undefined): string {
  const v = Number(value ?? 0);
  if (isNaN(v)) return "R$ 0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (abs >= 1_000) return `${sign}R$ ${Math.round(abs / 1_000)} mil`;
  return `${sign}R$ ${Math.round(abs)}`;
}

/**
 * Valor numérico → string para <input> de moeda ("1234,56"); nulo → "".
 * Fonte única das cópias locais de `fmt` nos dialogs de formulário.
 */
export function formatDecimalInput(v: number | string | null | undefined): string {
  return v != null ? Number(v).toFixed(2).replace(".", ",") : "";
}

export function parseBRL(value: string): number {
  if (!value) return 0;
  const cleaned = value
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

export function formatDateBR(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export function formatDateInput(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function parseDateBR(value: string): Date | null {
  if (!value) return null;
  // dd/mm/yyyy
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  // yyyy-mm-dd
  const m2 = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) {
    const [, yyyy, mm, dd] = m2;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Interpreta um parâmetro "YYYY-MM" (filtros de mês em URL/formulários).
 * Anos fora de 1990–2100 (ex.: dígito extra digitado no input de mês)
 * são rejeitados — o Postgres/Prisma não aceita essas datas.
 */
export function parseMonthParam(value: string | null | undefined): { year: number; month: number } | null {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 1990 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}

export function monthRange(reference: Date = new Date()) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
  return { start, end };
}

export function monthLabel(reference: Date = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(reference);
}
