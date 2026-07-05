import * as XLSX from "xlsx";
import { parseBRL } from "@/lib/format";

/**
 * Motor de importação de planilhas: leitura, parsing por tipo de coluna e
 * validação linha a linha. Nada é gravado aqui — só na confirmação (action).
 */

export type ImportColumn = {
  key: string;
  header: string; // cabeçalho na planilha (pt-BR)
  required?: boolean;
  kind: "text" | "date" | "money" | "int" | "enum";
  options?: { value: string; label: string }[]; // enum aceita valor OU rótulo
  example: string | number;
  description?: string;
};

export type RowError = { linha: number; campo: string; erro: string };

export type ValidatedRow = {
  linha: number; // linha na planilha (1-based, considerando o cabeçalho)
  data: Record<string, unknown>; // valores por column.key
  errors: RowError[];
  duplicate: boolean;
};

const MAX_ROWS = 500;

/** Lê a primeira aba (ou "Dados") e devolve linhas cruas por cabeçalho. */
export function readSheet(buffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames.includes("Dados") ? "Dados" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
}

const norm = (s: string) => s.trim().toLowerCase();

function isEmpty(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

function parseDateCell(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // normaliza para meia-noite local (células de data do Excel vêm com hora)
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // serial Excel (dias desde 1900) — fallback quando cellDates não pegou
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return buildDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** Constrói a data validando os componentes (rejeita 31/02, mês 99, ano fora de 1990-2100). */
function buildDate(y: number, m: number, d: number): Date | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function parseMoneyCell(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = String(v).trim().replace(/^R\$\s*/i, "");
  if (!s) return null;
  const n = parseBRL(s);
  return Number.isFinite(n) ? n : null;
}

/** Competência "mm/aaaa" ou "aaaa-mm" → {month, year}. */
export function parseCompetence(v: unknown): { month: number; year: number } | null {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    if (month >= 1 && month <= 12) return { month, year: Number(m[2]) };
    return null;
  }
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { month, year: Number(m[1]) };
    return null;
  }
  const d = parseDateCell(v);
  if (d) return { month: d.getMonth() + 1, year: d.getFullYear() };
  return null;
}

/**
 * Valida as linhas cruas contra as colunas da definição.
 * Retorna também erros de cabeçalho (colunas obrigatórias ausentes).
 */
export function validateRows(
  columns: ImportColumn[],
  rawRows: Record<string, unknown>[]
): { rows: ValidatedRow[]; headerErrors: string[] } {
  const headerErrors: string[] = [];
  if (rawRows.length === 0) {
    return { rows: [], headerErrors: ["Planilha vazia — preencha a aba \"Dados\"."] };
  }
  if (rawRows.length > MAX_ROWS) {
    return {
      rows: [],
      headerErrors: [`Máximo de ${MAX_ROWS} linhas por importação (planilha tem ${rawRows.length}).`],
    };
  }

  // Mapeia cabeçalhos reais (case/espacos-insensitive)
  const realHeaders = Object.keys(rawRows[0] ?? {});
  const headerMap = new Map<string, string>(); // column.key → header real
  for (const col of columns) {
    const found = realHeaders.find((h) => norm(h) === norm(col.header));
    if (found) headerMap.set(col.key, found);
    else if (col.required) headerErrors.push(`Coluna obrigatória ausente: "${col.header}"`);
  }
  if (headerErrors.length > 0) return { rows: [], headerErrors };

  const rows: ValidatedRow[] = rawRows.map((raw, i) => {
    const linha = i + 2; // 1 = cabeçalho
    const errors: RowError[] = [];
    const data: Record<string, unknown> = {};

    for (const col of columns) {
      const header = headerMap.get(col.key);
      const v = header != null ? raw[header] : "";
      if (isEmpty(v)) {
        if (col.required) errors.push({ linha, campo: col.header, erro: "obrigatório" });
        data[col.key] = null;
        continue;
      }
      switch (col.kind) {
        case "text":
          data[col.key] = String(v).trim();
          break;
        case "int": {
          const n = typeof v === "number" ? v : parseInt(String(v), 10);
          if (!Number.isFinite(n)) errors.push({ linha, campo: col.header, erro: `número inválido: "${v}"` });
          else data[col.key] = Math.trunc(n);
          break;
        }
        case "money": {
          const n = parseMoneyCell(v);
          if (n == null) errors.push({ linha, campo: col.header, erro: `valor inválido: "${v}" (use 1234,56)` });
          else data[col.key] = n;
          break;
        }
        case "date": {
          const d = parseDateCell(v);
          if (!d) errors.push({ linha, campo: col.header, erro: `data inválida: "${v}" (use dd/mm/aaaa)` });
          else data[col.key] = d;
          break;
        }
        case "enum": {
          const s = norm(String(v));
          const opt = col.options?.find((o) => norm(o.value) === s || norm(o.label) === s);
          if (!opt)
            errors.push({
              linha,
              campo: col.header,
              erro: `opção inválida: "${v}" (válidas: ${col.options?.map((o) => o.label).join(", ")})`,
            });
          else data[col.key] = opt.value;
          break;
        }
      }
    }
    return { linha, data, errors, duplicate: false };
  });

  // Linhas totalmente vazias são descartadas silenciosamente
  const nonEmpty = rows.filter((r) =>
    columns.some((c) => r.data[c.key] != null && r.data[c.key] !== "")
    || r.errors.length > 0
  );

  return { rows: nonEmpty, headerErrors };
}
