import { parseDateBR } from "@/lib/format";

/**
 * PERÍODO — FONTE ÚNICA DE ESTADO (RP-01 · auditoria de 11/09/2026).
 *
 * O relatório abriu /relatorios/financeiro-mensal?periodo=ano e leu, na mesma
 * tela, "Este ano" no subtítulo e "Este mês: 1 de set a 11 de set" no
 * controle. Não era texto errado: eram DUAS fontes de estado. O servidor
 * resolvia `?periodo=` e o seletor de datas só conhecia `?date=` e `?preset=`;
 * sem `?date=` na URL, ele caía no padrão "este mês" e anunciava isso como se
 * fosse o filtro vigente.
 *
 * Agora as duas leem esta tabela. `?periodo=` continua valendo (é o que as
 * visões salvas e os links antigos carregam) e passa a ter preset
 * equivalente, com o mesmo intervalo e o mesmo rótulo dos dois lados.
 *
 * PERÍODO PARCIAL (DA-04): "este mês" e "este ano" incluem dias que ainda não
 * aconteceram. Comparar setembro em curso com agosto inteiro faz o mês parecer
 * pior do que está. Por isso o Period carrega `parcial` e `decorridoAte`, e
 * quem exibe precisa dizer até onde o dado existe.
 */

export type PeriodKey = "hoje" | "semana" | "mes" | "trimestre" | "ano" | "custom";

export type Period = {
  key: PeriodKey;
  start: Date;
  end: Date; // exclusivo
  label: string;
  /** O período alcança o futuro — ainda está em curso. */
  parcial: boolean;
  /** Último dia já decorrido dentro do período (nulo quando não é parcial). */
  decorridoAte: Date | null;
  /** Preset equivalente, para o seletor mostrar o MESMO estado. */
  preset: DateRangePreset;
};

/** Presets do seletor de período (padrão Meta Ads + os do ERP). */
export type DateRangePreset =
  | "today" | "yesterday" | "today_yesterday"
  | "last_7_days" | "last_14_days" | "last_28_days" | "last_30_days"
  | "this_week" | "last_week" | "this_month" | "last_month"
  | "this_quarter" | "this_year" | "last_year"
  | "maximum" | "custom";

export const PRESET_LABEL: Record<DateRangePreset, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  today_yesterday: "Hoje e ontem",
  last_7_days: "Últimos 7 dias",
  last_14_days: "Últimos 14 dias",
  last_28_days: "Últimos 28 dias",
  last_30_days: "Últimos 30 dias",
  this_week: "Esta semana",
  last_week: "Semana passada",
  this_month: "Este mês",
  last_month: "Mês passado",
  this_quarter: "Este trimestre",
  this_year: "Este ano",
  last_year: "Ano passado",
  maximum: "Máximo",
  custom: "Personalizado",
};

/** Rótulo curto para o celular, onde o botão do seletor não cabe inteiro. */
export const PRESET_LABEL_CURTO: Partial<Record<DateRangePreset, string>> = {
  today_yesterday: "Hoje e ontem",
  last_7_days: "7 dias",
  last_14_days: "14 dias",
  last_28_days: "28 dias",
  last_30_days: "30 dias",
  this_week: "Esta semana",
  last_week: "Semana passada",
  this_month: "Este mês",
  last_month: "Mês passado",
  this_quarter: "Trimestre",
  this_year: "Este ano",
  last_year: "Ano passado",
};

/** `?periodo=` (legado, ainda usado por visões salvas) → preset equivalente. */
export const PERIODO_LEGADO: Record<string, DateRangePreset> = {
  hoje: "today",
  semana: "this_week",
  mes: "this_month",
  trimestre: "this_quarter",
  ano: "this_year",
};

const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const somaDias = (d: Date, n: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

/**
 * Intervalo INCLUSIVO de um preset. O fim pode cair no futuro — é o que faz
 * "este mês" ser o mês inteiro, e não só até hoje; quem precisa saber até
 * onde o dado existe lê `decorridoAte` no Period.
 */
export function presetRange(
  preset: DateRangePreset,
  minDate?: Date,
  hoje: Date = new Date()
): { start: Date; end: Date } {
  const hj = dia(hoje);
  const a = hj.getFullYear();
  const m = hj.getMonth();
  switch (preset) {
    case "today": return { start: hj, end: hj };
    case "yesterday": { const y = somaDias(hj, -1); return { start: y, end: y }; }
    case "today_yesterday": return { start: somaDias(hj, -1), end: hj };
    case "last_7_days": return { start: somaDias(hj, -6), end: hj };
    case "last_14_days": return { start: somaDias(hj, -13), end: hj };
    case "last_28_days": return { start: somaDias(hj, -27), end: hj };
    case "last_30_days": return { start: somaDias(hj, -29), end: hj };
    // ===== Presets de CONTAINER de calendário =====
    // Estes cobrem o período inteiro, inclusive os dias que ainda não
    // chegaram — "este mês" é setembro, não "setembro até hoje". É a
    // semântica que o servidor sempre teve para `?periodo=mes`, e mexer nela
    // mudaria o total de toda tela financeira: uma cobrança que vence dia 30
    // sairia do faturamento esperado de setembro. O seletor é que passa a
    // concordar com o servidor, e não o contrário.
    //
    // O que falta ser vivido fica declarado: o Period sai marcado `parcial`,
    // com `decorridoAte` em hoje, e o rótulo ganha "· parcial até dd/mm"
    // (DA-04). Sem isso, setembro em curso era comparado com agosto inteiro
    // e a queda aparente parecia piora consolidada.
    case "this_week": {
      const dow = (hj.getDay() + 6) % 7; // segunda = 0
      const start = somaDias(hj, -dow);
      return { start, end: somaDias(start, 6) };
    }
    case "last_week": {
      const dow = (hj.getDay() + 6) % 7;
      const start = somaDias(hj, -dow - 7);
      return { start, end: somaDias(start, 6) };
    }
    case "this_month":
      return { start: new Date(a, m, 1), end: new Date(a, m + 1, 0) };
    case "last_month": {
      const start = new Date(a, m - 1, 1);
      return { start, end: new Date(a, m, 0) };
    }
    case "this_quarter": {
      const q = Math.floor(m / 3);
      return { start: new Date(a, q * 3, 1), end: new Date(a, q * 3 + 3, 0) };
    }
    case "this_year":
      return { start: new Date(a, 0, 1), end: new Date(a, 11, 31) };
    case "last_year":
      return { start: new Date(a - 1, 0, 1), end: new Date(a - 1, 11, 31) };
    case "maximum":
      return { start: minDate ?? new Date(2020, 0, 1), end: hj };
    default:
      return { start: hj, end: hj };
  }
}

/** Um preset vira Period completo, já com a marca de parcial (DA-04). */
export function periodOfPreset(
  preset: DateRangePreset,
  hoje: Date = new Date(),
  rotulo?: string
): Period {
  const { start, end } = presetRange(preset, undefined, hoje);
  return montar(preset, start, end, rotulo ?? PRESET_LABEL[preset], hoje);
}

/** Monta o Period a partir de um intervalo inclusivo. */
function montar(
  preset: DateRangePreset,
  start: Date,
  fimInclusivo: Date,
  label: string,
  hoje: Date
): Period {
  const hj = dia(hoje);
  const end = somaDias(dia(fimInclusivo), 1); // exclusivo
  const parcial = dia(fimInclusivo) > hj && start <= hj;
  const chave: PeriodKey =
    preset === "this_month" ? "mes"
    : preset === "this_year" || preset === "last_year" ? "ano"
    : preset === "this_quarter" ? "trimestre"
    : preset === "this_week" || preset === "last_week" ? "semana"
    : preset === "today" ? "hoje"
    : "custom";
  return {
    key: chave,
    start: dia(start),
    end,
    label,
    parcial,
    decorridoAte: parcial ? hj : null,
    preset,
  };
}

export function resolvePeriod(
  searchParams: {
    periodo?: string;
    de?: string;
    ate?: string;
    date?: string; // "YYYY-MM-DD_YYYY-MM-DD"
    preset?: string;
  },
  hoje: Date = new Date()
): Period {
  const hj = dia(hoje);

  // ===== 1. Seletor de período: ?date=inicio_fim (inclusivo) + ?preset= =====
  if (searchParams.date) {
    const m = searchParams.date.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      const s = parseDateBR(m[1]);
      const e = parseDateBR(m[2]);
      if (s && e) {
        const p = searchParams.preset as DateRangePreset | undefined;
        const preset = p && PRESET_LABEL[p] ? p : "custom";
        const label = preset !== "custom" ? PRESET_LABEL[preset] : "Período personalizado";
        return montar(preset, s, e, label, hoje);
      }
    }
  }

  // ===== 2. Intervalo livre legado: ?de= e ?ate= =====
  const de = searchParams.de ? parseDateBR(searchParams.de) : null;
  const ate = searchParams.ate ? parseDateBR(searchParams.ate) : null;
  if (de || ate) {
    const start = de ?? new Date(hj.getFullYear(), 0, 1);
    const fim = ate ?? hj;
    return montar("custom", start, fim, "Período personalizado", hoje);
  }

  // ===== 3. Preset legado: ?periodo= — MESMA tabela que o seletor usa =====
  const preset = PERIODO_LEGADO[searchParams.periodo ?? ""] ?? "this_month";
  return periodOfPreset(preset, hoje);
}

/**
 * Period de um mês específico (competência) — usado por scripts e por telas
 * que navegam mês a mês, onde o "período" não vem de preset nem de URL.
 */
export function periodOfMonth(ano: number, mes: number, hoje: Date = new Date()): Period {
  const start = new Date(ano, mes - 1, 1);
  const fimInclusivo = new Date(ano, mes, 0);
  const label = `${String(mes).padStart(2, "0")}/${ano}`;
  const hj = dia(hoje);
  const ehMesCorrente = ano === hj.getFullYear() && mes === hj.getMonth() + 1;
  return {
    key: "mes",
    start,
    end: new Date(ano, mes, 1),
    label,
    parcial: ehMesCorrente,
    decorridoAte: ehMesCorrente ? hj : null,
    preset: ehMesCorrente ? "this_month" : "custom",
  };
}

/**
 * Rótulo com a ressalva de período parcial (DA-04).
 * "Este ano" vira "Este ano · parcial até 11/09" quando ainda está em curso.
 */
export function periodLabel(p: Period): string {
  if (!p.parcial || !p.decorridoAte) return p.label;
  const d = String(p.decorridoAte.getDate()).padStart(2, "0");
  const m = String(p.decorridoAte.getMonth() + 1).padStart(2, "0");
  return `${p.label} · parcial até ${d}/${m}`;
}
