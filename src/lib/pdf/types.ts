export type PdfTransaction = {
  date: Date;
  description: string;
  amount: number;
  installment?: number | null;
  totalInstallments?: number | null;
  /** Final (4 dígitos) do cartão físico/virtual, quando a fatura agrupa por cartão. */
  cardLastDigits?: string | null;
};

export type PdfParseResult = {
  layout: string;            // identificador do parser que casou
  transactions: PdfTransaction[];
  ignoredLines: string[];    // linhas que não casaram com transação
  closingDate?: Date;        // se detectado
  dueDate?: Date;            // se detectado
  totalDetected?: number;    // valor total da fatura, se encontrado
  issuer?: { key: string; label: string } | null; // banco/emissor detectado
};
