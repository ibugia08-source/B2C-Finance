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

export function resolvePeriod(searchParams: {
  periodo?: string;
  de?: string;
  ate?: string;
}): Period {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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
