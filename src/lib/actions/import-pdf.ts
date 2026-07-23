"use server";
import { prisma } from "@/lib/prisma";
import { revalidateFinance } from "@/lib/revalidate";
import {
  parseInvoicePdf,
  PdfImportError,
  type PdfTransaction,
  type PdfDiagnostics,
  type PdfErrorReason,
  type PdfParseResult,
} from "@/lib/pdf/parse-invoice-pdf";
import { matchCardsByIssuer } from "@/lib/pdf/detect-issuer";
import { requirePermission } from "@/lib/auth/viewer";
import {
  analyzeImportRows,
  commitAnalyzedRows,
  type ImportReference,
  type ImportRowInput,
} from "@/lib/services/import-engine";
import { invoiceReferenceFor, referenceFromDate } from "@/lib/services/invoices";
import type { CreditCard } from "@prisma/client";

export type PdfPreviewRow = PdfTransaction & {
  duplicate: boolean;
  hash: string;
  suggestedCategoryName?: string | null;
  suggestedResponsibleName?: string | null;
  historyMatched?: boolean;
};

export type DetectedCard = { id: string; name: string; bank: string | null };

export type PdfPreviewResult =
  | {
      ok: true;
      layout: string;
      rows: PdfPreviewRow[];
      ignoredLines: string[];
      closingDate?: Date;
      dueDate?: Date;
      totalDetected?: number;
      total: number;
      duplicates: number;
      diagnostics: PdfDiagnostics;
      // Detecção automática de banco/cartão
      detectedIssuer?: { key: string; label: string } | null;
      suggestedCardId?: string | null;
      candidateCards: DetectedCard[];
      // Fatura âncora sugerida (vencimento/fechamento do PDF, ou inferida)
      suggestedReference: ImportReference | null;
    }
  | {
      ok: false;
      error: string;
      reason?: PdfErrorReason;
      diagnostics?: PdfDiagnostics;
      detectedIssuer?: { key: string; label: string } | null;
    };

async function readFileBuffer(file: File): Promise<Buffer> {
  const ab = await file.arrayBuffer();
  return Buffer.from(new Uint8Array(ab));
}

function fileMeta(file: File) {
  return { name: file.name, size: file.size, type: file.type };
}

function parseReferenceInput(value: string | null): ImportReference | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return null;
  return { referenceMonth: month, referenceYear: year };
}

/**
 * Mês de referência da fatura:
 *  1. vencimento detectado no PDF;
 *  2. senão, fechamento detectado;
 *  3. senão, inferido pela compra mais recente + dia de fechamento do cartão.
 */
function referenceFromParsed(
  parsed: PdfParseResult,
  card: CreditCard | null
): ImportReference | null {
  if (parsed.dueDate) return referenceFromDate(parsed.dueDate);
  if (parsed.closingDate) return referenceFromDate(parsed.closingDate);
  if (card && parsed.transactions.length > 0) {
    const latest = new Date(
      Math.max(...parsed.transactions.map((t) => t.date.getTime()))
    );
    return invoiceReferenceFor(latest, card.closingDay);
  }
  return null;
}

function toEngineRows(transactions: PdfTransaction[]): ImportRowInput[] {
  return transactions.map((t) => ({
    date: t.date,
    description: t.description,
    amount: t.amount,
    isCredit: false,
    installment: t.installment ?? null,
    totalInstallments: t.totalInstallments ?? null,
    cardLastDigits: t.cardLastDigits ?? null,
  }));
}

export async function previewPdfImport(formData: FormData): Promise<PdfPreviewResult> {
  await requirePermission("importacoes.importar");
  const file = formData.get("file") as File | null;
  const explicitCardId = (formData.get("cardId") as string) || "";
  if (!file) return { ok: false, error: "Arquivo ausente." };

  let parsed;
  try {
    const buf = await readFileBuffer(file);
    if (process.env.NODE_ENV !== "production") {
      console.info("[pdf-import] preview", {
        name: file.name,
        type: file.type,
        size: file.size,
        bufferLen: buf.length,
      });
    }
    parsed = await parseInvoicePdf(buf, fileMeta(file));
  } catch (e: any) {
    if (e instanceof PdfImportError) {
      return {
        ok: false,
        error: e.message,
        reason: e.reason,
        diagnostics: e.diagnostics,
      };
    }
    return { ok: false, error: e?.message ?? "Erro ao processar PDF." };
  }

  // Detecção automática de banco → cartão
  const allCards = await prisma.creditCard.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  const detectedIssuer = parsed.issuer ?? null;
  const candidateCards = matchCardsByIssuer(detectedIssuer, allCards);
  const card =
    (explicitCardId && allCards.find((c) => c.id === explicitCardId)) ||
    (candidateCards.length === 1 ? candidateCards[0] : null) ||
    null;

  const reference = referenceFromParsed(parsed, card);

  const analysis = await analyzeImportRows({
    rows: toEngineRows(parsed.transactions),
    cardId: card?.id ?? null,
    accountId: null,
    holderId: card?.holderId ?? null,
    reference,
  });

  const rows: PdfPreviewRow[] = parsed.transactions.map((t, i) => {
    const a = analysis.rows[i];
    return {
      ...t,
      hash: card ? a.hash : "",
      duplicate: card ? a.duplicate : false,
      suggestedCategoryName: a.categoryId
        ? analysis.categoryNameById.get(a.categoryId) ?? null
        : null,
      suggestedResponsibleName: a.responsibleId
        ? analysis.personNameById.get(a.responsibleId) ?? null
        : null,
      historyMatched: a.historyMatched,
    };
  });

  return {
    ok: true,
    layout: parsed.layout,
    rows,
    ignoredLines: parsed.ignoredLines,
    closingDate: parsed.closingDate,
    dueDate: parsed.dueDate,
    totalDetected: parsed.totalDetected,
    total: rows.length,
    duplicates: card ? analysis.duplicates : 0,
    diagnostics: parsed.diagnostics,
    detectedIssuer,
    suggestedCardId: card?.id ?? null,
    candidateCards: candidateCards.map((c) => ({
      id: c.id,
      name: c.name,
      bank: c.bank,
    })),
    suggestedReference: reference,
  };
}

export type PdfCommitResult =
  | {
      ok: true;
      imported: number;
      duplicates: number;
      total: number;
      batchId: string;
      reference: ImportReference | null;
    }
  | { ok: false; error: string };

export async function commitPdfImport(formData: FormData): Promise<PdfCommitResult> {
  await requirePermission("importacoes.importar");
  const file = formData.get("file") as File | null;
  const cardId = (formData.get("cardId") as string) || "";
  const referenceInput = parseReferenceInput((formData.get("reference") as string) || null);
  if (!file) return { ok: false, error: "Arquivo ausente." };
  if (!cardId) return { ok: false, error: "Cartão não informado." };

  let parsed;
  try {
    const buf = await readFileBuffer(file);
    parsed = await parseInvoicePdf(buf, fileMeta(file));
  } catch (e: any) {
    return {
      ok: false,
      error:
        e instanceof PdfImportError
          ? e.message
          : e?.message ?? "Erro ao processar PDF.",
    };
  }

  if (parsed.transactions.length === 0) {
    return { ok: false, error: "Nenhuma transação reconhecida no PDF. Pré-visualize antes." };
  }

  const card = await prisma.creditCard.findUnique({ where: { id: cardId } });
  if (!card) return { ok: false, error: "Cartão não encontrado." };

  // Fatura ÂNCORA: escolhida pelo usuário > detectada no PDF > inferida.
  const reference = referenceInput ?? referenceFromParsed(parsed, card);
  if (!reference) {
    return {
      ok: false,
      error:
        "Não foi possível determinar o mês da fatura. Informe o mês de referência na importação.",
    };
  }

  const analysis = await analyzeImportRows({
    rows: toEngineRows(parsed.transactions),
    cardId: card.id,
    accountId: null,
    holderId: card.holderId,
    reference,
  });

  const outcome = await commitAnalyzedRows(analysis, {
    source: "pdf",
    fileName: file.name,
    card,
    accountId: null,
    reference,
    detected: {
      closingDate: parsed.closingDate,
      dueDate: parsed.dueDate,
      declaredTotal: parsed.totalDetected,
    },
  });

  revalidateFinance({ cardId });

  return {
    ok: true,
    batchId: outcome.batchId,
    imported: outcome.imported,
    duplicates: outcome.duplicates,
    total: parsed.transactions.length,
    reference: outcome.reference,
  };
}
