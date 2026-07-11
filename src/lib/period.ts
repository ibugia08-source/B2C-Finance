import { parseDateBR } from "@/lib/format";

/**
 * Período padrão do ERP: hoje | semana | mes | trimestre | ano | personalizado.
 * Lido de searchParams (?periodo=&de=&ate=) pelas páginas server.
 */

export type PeriodKey = "hoje" | "semana" | "mes" | "trimestre" | "ano" | "custom";

export type Period = {
  key: PeriodKey;
  start: Date;
  end: Date; // exclusivo
  label: string;
};

/** Rótulos dos presets do B2CDateRangePicker (padrão Meta Ads). */
export const PRESET_LABEL: Record<string, string> = {
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
  maximum: "Máximo",
  custom: "Personalizado",
};

export function resolvePeriod(searchParams: {
  periodo?: string;
  de?: string;
  ate?: string;
  date?: string; // "YYYY-MM-DD_YYYY-MM-DD" (B2CDateRangePicker)
  preset?: string;
}): Period {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // ===== B2CDateRangePicker: ?date=inicio_fim (inclusivo) + ?preset= =====
  if (searchParams.date) {
    const m = searchParams.date.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      const s = parseDateBR(m[1]);
      const e = parseDateBR(m[2]);
      if (s && e) {
        const end = new Date(e);
        end.setDate(end.getDate() + 1); // exclusivo
        const label =
          (searchParams.preset && PRESET_LABEL[searchParams.preset]) ||
          "Período personalizado";
        return { key: "custom", start: s, end, label };
      }
    }
  }

  const de = searchParams.de ? parseDateBR(searchParams.de) : null;
  const ate = searchParams.ate ? parseDateBR(searchParams.ate) : null;
  if (de || ate) {
    const start = de ?? new Date(now.getFullYear(), 0, 1);
    const end = ate ? new Date(ate) : new Date(today);
    end.setDate(end.getDate() + 1); // inclusivo
    return { key: "custom", start, end, label: "Período personalizado" };
  }

  switch (searchParams.periodo) {
    case "hoje": {
      const end = new Date(today);
      end.setDate(end.getDate() + 1);
      return { key: "hoje", start: today, end, label: "Hoje" };
    }
    case "semana": {
      const start = new Date(today);
      start.setDate(start.getDate() - start.getDay()); // domingo
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { key: "semana", start, end, label: "Esta semana" };
    }
    case "trimestre": {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1);
      const end = new Date(now.getFullYear(), q * 3 + 3, 1);
      return { key: "trimestre", start, end, label: "Este trimestre" };
    }
    case "ano": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear() + 1, 0, 1);
      return { key: "ano", start, end, label: "Este ano" };
    }
    case "mes":
    default: {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { key: "mes", start, end, label: "Este mês" };
    }
  }
}
