import * as XLSX from "xlsx";
import { parseDateBR } from "@/lib/format";

export type ParsedRow = {
  date: Date | null;
  description: string;
  amount: number;          // sempre não-negativo
  isCredit: boolean;       // true se o valor original era negativo (estorno/crédito)
  installment?: number | null;
  totalInstallments?: number | null;
  raw: Record<string, any>;
  reason?: string;         // preenchido quando a linha é inválida
};

export type ParseDiagnostics = {
  totalLines: number;
  validLines: number;
  ignoredLines: number;
  detectedColumns: {
    date: string | null;
    description: string | null;
    amount: string | null;
    installment: string | null;
    totalInstallments: string | null;
  };
  rawSample: Record<string, any>[];      // até 3 linhas brutas
  parsedSample: ParsedRow[];             // até 3 linhas normalizadas
  ignoredReasons: { line: number; reason: string; raw: Record<string, any> }[];
  rows: ParsedRow[];
};

function normalizeKey(k: string) {
  return (k || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const DATE_KEYS = [
  "data",
  "date",
  "dt",
  "lancamento",
  "data_lancamento",
  "data_da_compra",
  "data_de_compra",
  "data_compra",
  "posted_date",
  "transaction_date",
  "transaction_dt",
];

const DESC_KEYS = [
  "descricao",
  "description",
  "title",
  "estabelecimento",
  "historico",
  "lancamento",
  "detalhes",
  "merchant",
  "memo",
  "nome",
];

const AMOUNT_KEYS = [
  "valor",
  "amount",
  "value",
  "preco",
  "valor_original",
  "valor_brl",
  "transaction_amount",
  "valor_da_compra",
];

const INSTALLMENT_KEYS = ["parcela", "installment", "parcela_atual"];
const TOTAL_INSTALLMENT_KEYS = [
  "parcelas",
  "totalparcelas",
  "total_parcelas",
  "qtd_parcelas",
  "installments",
  "total_installments",
];

/** Indexa as chaves originais por chave normalizada. */
function indexKeys(row: Record<string, any>) {
  const out: Record<string, string> = {};
  for (const k of Object.keys(row)) out[normalizeKey(k)] = k;
  return out;
}

function pickKey(rowIdx: Record<string, string>, keys: string[]) {
  for (const k of keys) if (rowIdx[k]) return rowIdx[k];
  return null;
}

function toDate(v: any): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial
    const utc = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(utc);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  // YYYY-MM-DD ou YYYY/MM/DD
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  // DD/MM/YYYY ou DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const yyyy = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(yyyy, Number(m) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  return parseDateBR(s);
}

/**
 * Normaliza valor monetário aceitando formatos BR e US.
 * Regras:
 *   - se tem vírgula e ponto: o último dos dois é o separador decimal.
 *   - se tem só vírgula: separador decimal = vírgula.
 *   - se tem só ponto: ambíguo → se tem 1 ponto e ≤2 dígitos depois, é decimal; caso contrário é milhar.
 *   - tira "R$", espaços, converte negativo "()" típico.
 */
function toAmount(v: any): number {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (!s) return NaN;

  // negativo entre parênteses
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/r\$/i, "").replace(/\s+/g, "").trim();
  if (!s) return NaN;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized: string;

  if (hasComma && hasDot) {
    // último símbolo é o decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    // vários pontos? trata todos exceto o último como milhar
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1) {
      const last = s.lastIndexOf(".");
      normalized = s.slice(0, last).replace(/\./g, "") + "." + s.slice(last + 1);
    } else {
      // 1 ponto: se a parte após tiver 1-2 dígitos → decimal; caso contrário → milhar
      const parts = s.split(".");
      if (parts[1] && parts[1].length <= 2) normalized = s;
      else normalized = s.replace(/\./g, "");
    }
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (isNaN(n)) return NaN;
  return negative ? -n : n;
}

/** Tenta detectar parcelas dentro da própria descrição (Nubank: "AMAZON 2/3"). */
function pickInstallmentFromDescription(desc: string): {
  description: string;
  installment: number | null;
  total: number | null;
} {
  const text = desc.replace(INSTALLMENT_TEXT, "").replace(INSTALLMENT_PAREN, "");

  let installment: number | null = null;
  let total: number | null = null;

  const t1 = desc.match(INSTALLMENT_TEXT);
  if (t1) {
    installment = Number(t1[1]);
    total = Number(t1[2]);
  } else {
    const t2 = desc.match(INSTALLMENT_PAREN);
    if (t2) {
      installment = Number(t2[1]);
      total = Number(t2[2]);
    }
  }

  return {
    description: text.trim().replace(/\s{2,}/g, " "),
    installment,
    total,
  };
}

const INSTALLMENT_TEXT = /\bparcela\s+(\d{1,2})\s+(?:de|\/)\s+(\d{1,2})\b/i;
const INSTALLMENT_PAREN = /(?:^|\s|\()\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*(?=\)|$|\s)/;

export async function parseFile(file: File): Promise<ParseDiagnostics> {
  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  // XLSX.read aceita csv também; força sep auto e raw=false p/ strings.
  const wb = XLSX.read(buf, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: "",
    raw: false,
  });

  const totalLines = json.length;
  const detected = {
    date: null as string | null,
    description: null as string | null,
    amount: null as string | null,
    installment: null as string | null,
    totalInstallments: null as string | null,
  };

  // Determina colunas pela 1a linha não-vazia
  const sampleIdx = json.length > 0 ? indexKeys(json[0]) : {};
  detected.date = pickKey(sampleIdx, DATE_KEYS);
  detected.description = pickKey(sampleIdx, DESC_KEYS);
  detected.amount = pickKey(sampleIdx, AMOUNT_KEYS);
  detected.installment = pickKey(sampleIdx, INSTALLMENT_KEYS);
  detected.totalInstallments = pickKey(sampleIdx, TOTAL_INSTALLMENT_KEYS);

  const rows: ParsedRow[] = [];
  const ignoredReasons: ParseDiagnostics["ignoredReasons"] = [];

  json.forEach((row, idx) => {
    const isAllEmpty = Object.values(row).every(
      (v) => v == null || String(v).trim() === ""
    );
    if (isAllEmpty) return; // simplesmente pula linhas vazias

    const rowIdx = indexKeys(row);
    const dateKey = pickKey(rowIdx, DATE_KEYS);
    const descKey = pickKey(rowIdx, DESC_KEYS);
    const amountKey = pickKey(rowIdx, AMOUNT_KEYS);
    const instKey = pickKey(rowIdx, INSTALLMENT_KEYS);
    const totalInstKey = pickKey(rowIdx, TOTAL_INSTALLMENT_KEYS);

    const date = dateKey ? toDate(row[dateKey]) : null;
    let description = descKey ? String(row[descKey] ?? "").trim() : "";
    const amountRaw = amountKey ? toAmount(row[amountKey]) : NaN;

    let installment: number | null = null;
    let totalInstallments: number | null = null;
    if (instKey && row[instKey] !== "" && row[instKey] != null) {
      installment = Number(row[instKey]);
      if (isNaN(installment)) installment = null;
    }
    if (totalInstKey && row[totalInstKey] !== "" && row[totalInstKey] != null) {
      totalInstallments = Number(row[totalInstKey]);
      if (isNaN(totalInstallments)) totalInstallments = null;
    }
    // Tenta extrair parcela da descrição se não veio por coluna
    if (!installment && description) {
      const found = pickInstallmentFromDescription(description);
      description = found.description;
      installment = found.installment;
      totalInstallments = found.total;
    }

    const reasons: string[] = [];
    if (!date) reasons.push("data ausente/ inválida");
    if (!description) reasons.push("descrição ausente");
    if (!isFinite(amountRaw) || amountRaw === 0) reasons.push("valor ausente/ inválido");

    const isCredit = isFinite(amountRaw) && amountRaw < 0;
    const amount = isFinite(amountRaw) ? Math.abs(amountRaw) : 0;

    const parsed: ParsedRow = {
      date,
      description,
      amount,
      isCredit,
      installment,
      totalInstallments,
      raw: row,
      reason: reasons.length ? reasons.join(", ") : undefined,
    };
    rows.push(parsed);
    if (parsed.reason) {
      ignoredReasons.push({ line: idx + 1, reason: parsed.reason, raw: row });
    }
  });

  const validRows = rows.filter((r) => !r.reason);
  return {
    totalLines,
    validLines: validRows.length,
    ignoredLines: rows.length - validRows.length,
    detectedColumns: detected,
    rawSample: json.slice(0, 3),
    parsedSample: rows.slice(0, 3),
    ignoredReasons: ignoredReasons.slice(0, 50),
    rows,
  };
}
