import type { PdfParseResult, PdfTransaction } from "../types";
import { adjustYearToAnchor } from "./shared";

/**
 * Parsers para os layouts ATUAIS (2026) das faturas fechadas — modelos reais
 * enviados pela B2C (Nubank e C6 Bank).
 *
 * A extração usa o pagerender com espaçamento (parse-invoice-pdf), então as
 * linhas chegam como: "04 JUN •••• 9560 Mp *Storealefsigma - Parcela 3/4 R$ 33,50"
 * (Nubank) e "16 mai TIM*75991826353 78,99" (C6, valor sem "R$").
 *
 * Importamos apenas COMPRAS: pagamentos, créditos, estornos e encargos de
 * atraso (multa/IOF/juros — que se compensam com créditos na mesma fatura)
 * ficam de fora, para a soma bater com o "Total de compras" da fatura.
 */

const MONTHS_PT: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

const SKIP_DESC =
  /^(pagamento|saldo|cr[eé]dito|encerramento|estorno|multa|iof|juros|subtotal|total|desconto de antecipa)/i;

const INSTALLMENT_RE = /[\s\-–—]*Parcela\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;

const AMOUNT_RE = /^(\d{1,3}(?:\.\d{3})*,\d{2})\.?$/;

const toAmount = (raw: string) => Number(raw.replace(/\./g, "").replace(",", "."));

function monthIdx(mmm: string): number | null {
  const k = mmm.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 3);
  return k in MONTHS_PT ? MONTHS_PT[k] : null;
}

/** Remove prefixo de cartão ("•••• 9560", "**** 9560") e devolve os dígitos. */
function stripCardPrefix(desc: string): { desc: string; digits: string | null } {
  const m = desc.match(/^[^A-Za-z0-9]{1,8}\s*(\d{4})\s+(.*)$/);
  if (m) return { desc: m[2], digits: m[1] };
  return { desc, digits: null };
}

function buildTx(
  date: Date,
  rawDesc: string,
  amount: number,
  cardDigits: string | null
): PdfTransaction | null {
  let desc = rawDesc.trim();
  let installment: number | null = null;
  let totalInstallments: number | null = null;
  const inst = desc.match(INSTALLMENT_RE);
  if (inst) {
    installment = Number(inst[1]);
    totalInstallments = Number(inst[2]);
    desc = desc.replace(INSTALLMENT_RE, "");
  }
  desc = desc.replace(/[\s\-–—•*]+$/, "").replace(/^[\s\-–—•*]+/, "").trim();
  if (!desc || SKIP_DESC.test(desc)) return null;
  return { date, description: desc, amount, installment, totalInstallments, cardLastDigits: cardDigits };
}

// ===================================================================
// Nubank (layout 2026) — "04 JUN •••• 9560 Descrição R$ 33,50"
// ===================================================================

function nubankDueDate(text: string): Date | undefined {
  const m =
    text.match(/data de vencimento:?\s*(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})/i) ??
    text.match(/FATURA\s+(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})/);
  if (!m) return undefined;
  const mi = monthIdx(m[2]);
  if (mi == null) return undefined;
  return new Date(Number(m[3]), mi, Number(m[1]));
}

export function tryNubank2026(text: string): PdfParseResult | null {
  if (!/nubank|nu pagamentos/i.test(text)) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const due = nubankDueDate(text);
  const year = due?.getFullYear() ?? new Date().getFullYear();

  const start = lines.findIndex((l) => /^TRANSAÇÕES/i.test(l));
  if (start === -1) return null;

  const transactions: PdfTransaction[] = [];
  const ignored: string[] = [];

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    // precisa começar com "DD MMM"
    const d = line.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(.+)$/);
    if (!d) continue;
    const mi = monthIdx(d[2]);
    if (mi == null) continue;

    const rest = d[3];
    // valor = o que vem depois do ÚLTIMO "R$"
    const rIdx = rest.lastIndexOf("R$");
    if (rIdx === -1) continue;
    const amountStr = rest.slice(rIdx + 2).trim().replace(/\.$/, "");
    if (!AMOUNT_RE.test(amountStr)) {
      ignored.push(line);
      continue;
    }
    let before = rest.slice(0, rIdx).trim();
    // crédito/pagamento: sinal (−, – ou -) imediatamente antes do R$
    if (/[−–-]$/.test(before)) {
      ignored.push(line);
      continue;
    }
    const { desc, digits } = stripCardPrefix(before);
    const tx = buildTx(
      adjustYearToAnchor(new Date(year, mi, Number(d[1])), due),
      desc,
      toAmount(amountStr),
      digits
    );
    if (tx) transactions.push(tx);
    else ignored.push(line);
  }

  if (transactions.length === 0) return null;

  const totalM = text.match(
    /total de compras[^\n]*?R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i
  ) ?? text.match(/total a pagar\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  return {
    layout: "nubank-2026",
    transactions,
    ignoredLines: ignored,
    dueDate: due,
    totalDetected: totalM ? toAmount(totalM[1]) : undefined,
  };
}

// ===================================================================
// C6 Bank (layout 2026) — "16 mai TIM*75991826353 78,99" (sem R$)
// ===================================================================

function c6Dates(text: string): { due?: Date; closing?: Date } {
  const close = text.match(/fechamento desta fatura em\s*(\d{2})\/(\d{2})\/(\d{2,4})/i);
  const closing = close
    ? new Date(
        Number(close[3].length === 2 ? "20" + close[3] : close[3]),
        Number(close[2]) - 1,
        Number(close[1])
      )
    : undefined;
  const m = text.match(/vencimento:?\s*(\d{1,2})\s+de\s+([A-Za-zç]+)/i);
  if (!m) return { closing };
  const mi = monthIdx(m[2]);
  if (mi == null) return { closing };
  let year = closing?.getFullYear() ?? new Date().getFullYear();
  if (closing && mi < closing.getMonth()) year += 1; // virada de ano
  return { due: new Date(year, mi, Number(m[1])), closing };
}

export function tryC62026(text: string): PdfParseResult | null {
  if (!/c6\s*bank|cart[aã]o c6/i.test(text)) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const { due, closing } = c6Dates(text);
  const anchor = closing ?? due;
  const year = anchor?.getFullYear() ?? new Date().getFullYear();

  const transactions: PdfTransaction[] = [];
  const ignored: string[] = [];
  let currentCardDigits: string | null = null;

  for (const line of lines) {
    // cabeçalho de seção por cartão: "Cartão C6 Virtual Final 6061 - ISRAEL ..."
    const sec = line.match(/^Cart[aã]o\b.*?Final\s+(\d{4})/i);
    if (sec) {
      currentCardDigits = sec[1];
      continue;
    }
    const d = line.match(/^(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b\s*(.+)$/i);
    if (!d) continue;
    const mi = monthIdx(d[2])!;
    const rest = d[3].trim();
    // valor = último token no formato monetário (sem "R$")
    const m = rest.match(/^(.*?)\s*(-?)(\d{1,3}(?:\.\d{3})*,\d{2})$/);
    if (!m) {
      ignored.push(line);
      continue;
    }
    const [, descRaw, sign, amountStr] = m;
    if (sign) {
      ignored.push(line);
      continue;
    }
    const tx = buildTx(
      adjustYearToAnchor(new Date(year, mi, Number(d[1])), anchor),
      descRaw,
      toAmount(amountStr),
      currentCardDigits
    );
    if (tx) transactions.push(tx);
    else ignored.push(line);
  }

  if (transactions.length === 0) return null;

  const totalM =
    text.match(/total a pagar\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i) ??
    text.match(/valor da fatura:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  return {
    layout: "c6-2026",
    transactions,
    ignoredLines: ignored,
    dueDate: due,
    closingDate: closing,
    totalDetected: totalM ? toAmount(totalM[1]) : undefined,
  };
}
