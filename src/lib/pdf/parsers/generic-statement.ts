import type { PdfParseResult, PdfTransaction } from "../types";
import { matchCardSection, adjustYearToAnchor } from "./shared";

/**
 * Parser genérico de extrato — captura lançamentos com data + descrição + valor
 * em formatos variados, lidando com quebras de linha do pdf-parse.
 *
 * Suporta:
 *  - "DD MMM"   (15 SET, 02 dez)
 *  - "DD/MM"    (15/09)
 *  - "DD/MM/AAAA" ou "DD/MM/AA"
 *  - "DD-MM-AAAA"
 * Valor:
 *  - opcional "R$"
 *  - vírgula decimal ou ponto decimal
 *  - opcional sinal negativo (estornos/créditos) ou prefixo "- "
 * Parcelas (no fim ou meio da descrição):
 *  - "1/3", "01/03", "(1/3)"
 *  - "Parcela 1 de 3"
 */

const MONTHS_PT: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

const DATE_HEADER = String.raw`(?:(\d{1,2})\s+([A-Za-zçÇ]{3,4})|(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?)`;
const AMOUNT_TAIL = String.raw`(-?\s*R?\$?\s*-?\d{1,3}(?:[\.,]\d{3})*[\.,]\d{2})\s*(?:CR|D|C)?$`;

const LINE_RE = new RegExp(`^\\s*${DATE_HEADER}\\s+(.+?)\\s+${AMOUNT_TAIL}`, "i");

const INSTALLMENT_TEXT = /\bparcela\s+(\d{1,2})\s+(?:de|\/)\s+(\d{1,2})\b/i;
const INSTALLMENT_PAREN = /(?:^|\s|\()\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*(?=\)|$|\s)/;

function parseAmount(raw: string): number {
  let s = raw.replace(/r\$/i, "").replace(/\s+/g, "").replace(/cr$/i, "").trim();
  let neg = false;
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  // se tem , e .: o último é decimal
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized = s;
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length > 2) normalized = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
    else if (parts[1] && parts[1].length <= 2) normalized = s;
    else normalized = s.replace(/\./g, "");
  }
  const n = Number(normalized);
  return neg ? -n : n;
}

function detectYear(text: string): number {
  const m = text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

function detectClosingAndDue(text: string): { closing?: Date; due?: Date } {
  const out: { closing?: Date; due?: Date } = {};
  const dueDmy = text.match(/venc[ie]mento[^\d]*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (dueDmy) {
    const [, d, m, y] = dueDmy;
    out.due = new Date(Number(y.length === 2 ? "20" + y : y), Number(m) - 1, Number(d));
  }
  const closeDmy = text.match(/fechamento[^\d]*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (closeDmy) {
    const [, d, m, y] = closeDmy;
    out.closing = new Date(Number(y.length === 2 ? "20" + y : y), Number(m) - 1, Number(d));
  }
  return out;
}

function detectTotal(text: string): number | undefined {
  const candidates = [
    /total\s+da\s+fatura[^\d]*(?:R\$\s*)?(-?\d{1,3}(?:[\.,]\d{3})*[\.,]\d{2})/i,
    /valor\s+total[^\d]*(?:R\$\s*)?(-?\d{1,3}(?:[\.,]\d{3})*[\.,]\d{2})/i,
    /pagamento\s+m[ií]nimo[^\d]*(?:R\$\s*)?(-?\d{1,3}(?:[\.,]\d{3})*[\.,]\d{2})/i,
  ];
  for (const re of candidates.slice(0, 2)) {
    const m = text.match(re);
    if (m) return Math.abs(parseAmount(m[1]));
  }
  return undefined;
}

function extractInstallment(desc: string): {
  description: string;
  installment: number | null;
  total: number | null;
} {
  let installment: number | null = null;
  let total: number | null = null;
  let out = desc;
  const t1 = out.match(INSTALLMENT_TEXT);
  if (t1) {
    installment = Number(t1[1]);
    total = Number(t1[2]);
    out = out.replace(INSTALLMENT_TEXT, "");
  } else {
    const t2 = out.match(INSTALLMENT_PAREN);
    if (t2) {
      installment = Number(t2[1]);
      total = Number(t2[2]);
      out = out.replace(INSTALLMENT_PAREN, " ");
    }
  }
  return { description: out.replace(/\s{2,}/g, " ").trim(), installment, total };
}

/**
 * Junta linhas que foram quebradas pelo pdf-parse: se uma linha tem só data
 * mas não tem valor, tenta concatenar com a próxima até encontrar valor.
 */
function preprocessLines(text: string): string[] {
  const raw = text.split(/\r?\n/).map((l) => l.trim());
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (!line) continue;
    out.push(line);
  }
  return out;
}

export function tryGenericStatement(text: string): PdfParseResult & {
  sampleLines: string[];
} {
  const meta = detectClosingAndDue(text);
  const anchor = meta.closing ?? meta.due;
  const fallbackYear = anchor?.getFullYear() ?? detectYear(text);
  const lines = preprocessLines(text);

  const transactions: PdfTransaction[] = [];
  const ignored: string[] = [];
  let currentCardDigits: string | null = null;

  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (!m) {
      const digits = matchCardSection(line);
      if (digits) {
        currentCardDigits = digits;
        continue;
      }
      // Filtra linhas curtas ou de cabeçalho — só registra como ignorada se
      // parecer relevante (tem números no fim).
      if (/\d{1,3}[\.,]\d{2}\s*$/.test(line)) ignored.push(line);
      continue;
    }
    // Grupos: 1=DD (DDMMM) 2=MMM, 3=DD (DDMMYY) 4=MM, 5=YY?, 6=desc, 7=valor
    const ddText = m[1];
    const mmmText = m[2];
    const ddNum = m[3];
    const mmNum = m[4];
    const yyOpt = m[5];
    const descRaw = m[6];
    const amountStr = m[7];

    let date: Date | null = null;
    if (ddText && mmmText) {
      const k = mmmText
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .slice(0, 3);
      if (k in MONTHS_PT) {
        date = adjustYearToAnchor(
          new Date(fallbackYear, MONTHS_PT[k], Number(ddText)),
          anchor
        );
      }
    } else if (ddNum && mmNum) {
      let y = fallbackYear;
      if (yyOpt) y = Number(yyOpt.length === 2 ? "20" + yyOpt : yyOpt);
      date = new Date(y, Number(mmNum) - 1, Number(ddNum));
      if (!yyOpt) date = adjustYearToAnchor(date, anchor);
    }
    if (!date || isNaN(date.getTime())) {
      ignored.push(line);
      continue;
    }

    const amount = parseAmount(amountStr);
    if (!isFinite(amount) || amount === 0) {
      ignored.push(line);
      continue;
    }

    const inst = extractInstallment(descRaw.trim());
    transactions.push({
      date,
      description: inst.description,
      amount: Math.abs(amount),
      installment: inst.installment,
      totalInstallments: inst.total,
      cardLastDigits: currentCardDigits,
    });
  }

  return {
    layout: "generic-statement",
    transactions,
    ignoredLines: ignored,
    closingDate: meta.closing,
    dueDate: meta.due,
    totalDetected: detectTotal(text),
    sampleLines: lines.slice(0, 30),
  };
}
