/**
 * Utilitários compartilhados pelos parsers de fatura em PDF.
 */

// Cabeçalho de seção por cartão dentro da fatura, ex.:
//   "CARTÃO •••• 1234", "Final 5678", "Cartão terminado em 4321",
//   "NUBANK •••• 9012 - ISRAEL"
const CARD_SECTION_RES: RegExp[] = [
  /(?:cart[aã]o|final|terminado\s+em)\D*?(\d{4})\s*(?:[-–—].*)?$/i,
  /[•*]{2,}\s*(\d{4})/,
];

/**
 * Se a linha parece um cabeçalho de seção de cartão (e não uma transação),
 * retorna os 4 últimos dígitos; senão null. Chamar apenas para linhas que
 * NÃO casaram com o padrão de transação do parser.
 */
export function matchCardSection(line: string): string | null {
  if (line.length > 80) return null; // cabeçalhos são curtos
  for (const re of CARD_SECTION_RES) {
    const m = line.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Corrige o ano de uma data de compra usando a data-âncora da fatura
 * (fechamento/vencimento): compras não podem ser posteriores à âncora.
 * Ex.: fatura de jan/2026 com compras de dezembro → dezembro/2025.
 */
export function adjustYearToAnchor(date: Date, anchor?: Date): Date {
  if (!anchor) return date;
  const GRACE_MS = 20 * 86400 * 1000; // tolerância p/ compras pós-fechamento
  if (date.getTime() > anchor.getTime() + GRACE_MS) {
    return new Date(date.getFullYear() - 1, date.getMonth(), date.getDate());
  }
  return date;
}
