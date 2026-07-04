import type { PdfParseResult, PdfTransaction } from "../types";
import { matchCardSection } from "./shared";

/**
 * Parser "inter-like" — fatura do Banco Inter (e layouts semelhantes onde a
 * data vem por extenso "DD de MMM. AAAA" colada à descrição).
 *
 * Exemplos de linha de transação:
 *   "03 de fev. 2026FARMACIAS DA ECONOMIA (Parcela 04 de 04)-R$ 15,71"
 *   "15 de mai. 2026JIM.COM* 58298802 HEB-R$ 10,00"
 *   "04 de mai. 2026PAGAMENTO ON LINE-+ R$ 9.455,48"   (crédito/pagamento → ignorado)
 *
 * Formato: <dia> de <mês abrev>. <ano><descrição>[(Parcela X de Y)]<sinal>R$ <valor>
 *   - sinal "-R$"  → compra (despesa)
 *   - sinal "-+ R$" ou "+ R$" → crédito/pagamento (não entra como compra)
 */

const MONTHS_PT: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

const DATE_RE = /^(\d{1,2})\s+de\s+([a-zçA-ZÇ]{3,4})\.?\s+(\d{4})(.+)$/;
// valor colado no fim da linha (compras nacionais)
const VALUE_RE = /(-?\s*\+?\s*)R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
// valor sozinho numa linha própria (compras internacionais em dólar)
const STANDALONE_VALUE_RE = /^(-?\s*\+?\s*)R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
const INSTALLMENT_RE = /\(?\s*parcela\s+(\d{1,2})\s+de\s+(\d{1,2})\s*\)?/i;

function parseAmount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function normMonth(mmm: string): string {
  return mmm
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .slice(0, 3);
}

function detectDue(text: string): Date | undefined {
  const m = text.match(/data\s+de\s+vencimento[^\d]*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return undefined;
}

function detectTotal(text: string): number | undefined {
  const m = text.match(/total\s+da\s+sua\s+fatura[^\d]*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (m) return parseAmount(m[1]);
  return undefined;
}

export function tryInterLike(text: string): PdfParseResult | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const transactions: PdfTransaction[] = [];
  const ignored: string[] = [];
  let currentCardDigits: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DATE_RE);
    if (!m) {
      const digits = matchCardSection(lines[i]);
      if (digits) currentCardDigits = digits;
      continue;
    }

    const [, dd, mmm, yyyy, restRaw] = m;
    const monthKey = normMonth(mmm);
    if (!(monthKey in MONTHS_PT)) continue;

    const rest = restRaw.trim();
    let signPart = "";
    let valueStr: string | null = null;
    let descSource = rest;
    let consumedAhead = 0;

    const inline = rest.match(VALUE_RE);
    if (inline) {
      signPart = inline[1] ?? "";
      valueStr = inline[2];
      descSource = rest.slice(0, inline.index);
    } else {
      // Compra internacional: o valor em R$ vem numa linha à frente
      // (após "Valor e símbolo...", "Valor em dólar...", "Cotação..."). Procura
      // a próxima linha que seja SÓ o valor, parando se chegar na próxima compra.
      for (let k = 1; k <= 6 && i + k < lines.length; k++) {
        const nxt = lines[i + k];
        if (DATE_RE.test(nxt)) break;
        const sv = nxt.match(STANDALONE_VALUE_RE);
        if (sv) {
          signPart = sv[1] ?? "";
          valueStr = sv[2];
          consumedAhead = k;
          break;
        }
      }
    }

    if (!valueStr) {
      ignored.push(lines[i]);
      continue;
    }

    const isCredit = signPart.includes("+");
    // Créditos/pagamentos (ex.: "PAGAMENTO ON LINE", estornos) não são compras
    if (isCredit) {
      i += consumedAhead;
      continue;
    }

    const amount = parseAmount(valueStr);
    if (!amount) {
      i += consumedAhead;
      continue;
    }

    const date = new Date(Number(yyyy), MONTHS_PT[monthKey], Number(dd));

    // descrição = tudo antes do trecho do valor, sem o traço/sinal final
    let description = descSource.replace(/[-+\s]+$/, "").trim();

    let installment: number | null = null;
    let totalInstallments: number | null = null;
    const inst = description.match(INSTALLMENT_RE);
    if (inst) {
      installment = Number(inst[1]);
      totalInstallments = Number(inst[2]);
      description = description.replace(INSTALLMENT_RE, "").trim();
    }

    if (!description) description = "Transação";
    transactions.push({
      date,
      description,
      amount,
      installment,
      totalInstallments,
      cardLastDigits: currentCardDigits,
    });
    i += consumedAhead;
  }

  if (transactions.length === 0) return null;

  return {
    layout: "inter-like",
    transactions,
    ignoredLines: ignored,
    dueDate: detectDue(text),
    totalDetected: detectTotal(text),
  };
}
