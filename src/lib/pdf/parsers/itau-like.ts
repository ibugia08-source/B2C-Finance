import type { PdfParseResult, PdfTransaction } from "../types";
import { matchCardSection, adjustYearToAnchor } from "./shared";

/**
 * Parser "itau-like" — faturas com data DD/MM ou DD/MM/AA, descrição e valor.
 *
 * Linhas de exemplo:
 *   "12/09  POSTO IPIRANGA SP             150,00"
 *   "05/10/24  AMAZON SP 03/06             89,90"
 *   "15/09  UBER * VIAGEM                 25,40"
 *
 * Parcelas no fim: "03/06" ou "(3/6)" ou "Parcela 3 de 6".
 */

const LINE_RE =
  /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\s+(.+?)\s+(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;

const INSTALLMENT_PAREN_RE = /\(?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)?\s*$/;
const INSTALLMENT_TEXT_RE = /parcela\s+(\d{1,2})\s+de\s+(\d{1,2})/i;

function parseAmount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function detectYear(text: string): number {
  const m = text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

function detectClosingAndDue(text: string): { closing?: Date; due?: Date } {
  const out: { closing?: Date; due?: Date } = {};
  const dueDmy = text.match(/venc[ie]mento[^\d]*(\d{2})\/(\d{2})\/(\d{2,4})/i);
  if (dueDmy) {
    const [, d, m, y] = dueDmy;
    out.due = new Date(Number(y.length === 2 ? "20" + y : y), Number(m) - 1, Number(d));
  }
  const closeDmy = text.match(/fechamento[^\d]*(\d{2})\/(\d{2})\/(\d{2,4})/i);
  if (closeDmy) {
    const [, d, m, y] = closeDmy;
    out.closing = new Date(Number(y.length === 2 ? "20" + y : y), Number(m) - 1, Number(d));
  }
  return out;
}

function detectTotal(text: string): number | undefined {
  const m = text.match(/total\s+da\s+fatura[^\d]*(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (m) return parseAmount(m[1]);
  const m2 = text.match(/valor\s+total[^\d]*(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (m2) return parseAmount(m2[1]);
  return undefined;
}

export function tryItauLike(text: string): PdfParseResult | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const { closing, due } = detectClosingAndDue(text);
  const anchor = closing ?? due;
  const fallbackYear = anchor?.getFullYear() ?? detectYear(text);
  const transactions: PdfTransaction[] = [];
  const ignored: string[] = [];
  let currentCardDigits: string | null = null;

  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (!m) {
      const digits = matchCardSection(line);
      if (digits) currentCardDigits = digits;
      continue;
    }
    const [, dd, mm, yyOpt, descRaw, amountStr] = m;
    const day = Number(dd);
    const month = Number(mm) - 1;
    let year = fallbackYear;
    if (yyOpt) {
      year = Number(yyOpt.length === 2 ? "20" + yyOpt : yyOpt);
    }
    let date = new Date(year, month, day);
    if (!yyOpt) date = adjustYearToAnchor(date, anchor);
    const amount = Math.abs(parseAmount(amountStr));
    if (!amount) continue;

    let description = descRaw.trim();
    let installment: number | null = null;
    let totalInstallments: number | null = null;

    const instText = description.match(INSTALLMENT_TEXT_RE);
    if (instText) {
      installment = Number(instText[1]);
      totalInstallments = Number(instText[2]);
      description = description.replace(INSTALLMENT_TEXT_RE, "").trim();
    } else {
      const instParen = description.match(INSTALLMENT_PAREN_RE);
      if (instParen) {
        installment = Number(instParen[1]);
        totalInstallments = Number(instParen[2]);
        description = description.replace(INSTALLMENT_PAREN_RE, "").trim();
      }
    }

    transactions.push({
      date,
      description,
      amount,
      installment,
      totalInstallments,
      cardLastDigits: currentCardDigits,
    });
  }

  if (transactions.length === 0) return null;

  return {
    layout: "itau-like",
    transactions,
    ignoredLines: ignored,
    closingDate: closing,
    dueDate: due,
    totalDetected: detectTotal(text),
  };
}
