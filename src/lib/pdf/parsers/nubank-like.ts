import type { PdfParseResult, PdfTransaction } from "../types";
import { matchCardSection, adjustYearToAnchor } from "./shared";

/**
 * Parser "nubank-like" — fatura típica do Nubank e bancos digitais.
 *
 * Características:
 *   - Linhas de transação no formato: "DD MMM <descrição> <valor>"
 *     ex: "15 SET  PADARIA SANTA EFIGENIA  R$ 25,90"
 *   - Parcelas no fim da descrição: "Parcela 2/4" ou "(2/4)"
 *   - Valor pode vir com "R$" ou só o número decimal com vírgula.
 */

const MONTHS_PT: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

const LINE_RE =
  /^(\d{1,2})\s+([A-Za-zçÇ]{3})\s+(.+?)\s+(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;

const INSTALLMENT_RE =
  /(?:parcela\s*)?\(?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)?/i;

function parseAmount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function detectYear(text: string): number {
  const m = text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

function detectClosingAndDue(text: string): { closing?: Date; due?: Date } {
  const out: { closing?: Date; due?: Date } = {};
  // "vencimento 15 SET 2024" ou "Data de vencimento: 15/09/2024"
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
  const m = text.match(/valor\s+total[^\d]*(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (m) return parseAmount(m[1]);
  const m2 = text.match(/total\s+da\s+fatura[^\d]*(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (m2) return parseAmount(m2[1]);
  return undefined;
}

export function tryNubankLike(text: string): PdfParseResult | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Âncora de ano: datas reais da fatura (fechamento/vencimento) quando
  // detectadas — evita atribuir o ano errado em faturas na virada do ano.
  const { closing, due } = detectClosingAndDue(text);
  const anchor = closing ?? due;
  const year = anchor?.getFullYear() ?? detectYear(text);

  const transactions: PdfTransaction[] = [];
  const ignored: string[] = [];
  let currentCardDigits: string | null = null;

  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (!m) {
      // Cabeçalho de seção por cartão ("CARTÃO •••• 1234")?
      const digits = matchCardSection(line);
      if (digits) currentCardDigits = digits;
      continue;
    }
    const [, dd, mmm, descRaw, amountStr] = m;
    const monthKey = mmm
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .slice(0, 3);
    if (!(monthKey in MONTHS_PT)) {
      ignored.push(line);
      continue;
    }
    const monthIdx = MONTHS_PT[monthKey];
    const date = adjustYearToAnchor(new Date(year, monthIdx, Number(dd)), anchor);
    const amount = Math.abs(parseAmount(amountStr));
    if (!amount) continue;

    let description = descRaw.trim();
    let installment: number | null = null;
    let totalInstallments: number | null = null;

    const inst = description.match(INSTALLMENT_RE);
    if (inst) {
      installment = Number(inst[1]);
      totalInstallments = Number(inst[2]);
      description = description.replace(INSTALLMENT_RE, "").trim();
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
    layout: "nubank-like",
    transactions,
    ignoredLines: ignored,
    closingDate: closing,
    dueDate: due,
    totalDetected: detectTotal(text),
  };
}
