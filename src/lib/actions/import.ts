"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { parseFile, type ParseDiagnostics, type ParsedRow } from "@/lib/services/parseImport";
import {
  analyzeImportRows,
  commitAnalyzedRows,
  type ImportReference,
  type ImportRowInput,
} from "@/lib/services/import-engine";
import { invoiceReferenceFor, recalcInvoiceTotal } from "@/lib/services/invoices";
import { getViewer } from "@/lib/auth/viewer";
import type { CreditCard } from "@prisma/client";

export type PreviewRow = {
  date: Date | null;
  description: string;
  amount: number;
  isCredit: boolean;
  installment?: number | null;
  totalInstallments?: number | null;
  duplicate: boolean;
  hash: string;
  reason?: string;
  suggestedCategoryName?: string | null;
  suggestedResponsibleName?: string | null;
  historyMatched?: boolean;
};

export type PreviewResult =
  | {
      ok: true;
      total: number;             // total de linhas lidas
      valid: number;             // linhas reconhecidas
      ignored: number;           // linhas ignoradas
      duplicates: number;
      detectedColumns: ParseDiagnostics["detectedColumns"];
      rawSample: Record<string, any>[];
      parsedSample: ParsedRow[];
      ignoredReasons: ParseDiagnostics["ignoredReasons"];
      rows: PreviewRow[];
      // Fatura âncora sugerida (quando importando para um cartão)
      suggestedReference: ImportReference | null;
    }
  | { ok: false; error: string };

/** Lê "YYYY-MM" enviado pelo formulário. */
function parseReferenceInput(value: string | null): ImportReference | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return null;
  return { referenceMonth: month, referenceYear: year };
}

/** Fallback de referência: fatura correspondente à compra mais recente. */
function inferReference(
  rows: { date: Date | null }[],
  card: CreditCard
): ImportReference | null {
  const dates = rows.map((r) => r.date).filter(Boolean) as Date[];
  if (dates.length === 0) return null;
  const latest = new Date(Math.max(...dates.map((d) => d.getTime())));
  return invoiceReferenceFor(latest, card.closingDay);
}

function toEngineRows(rows: ParsedRow[]): ImportRowInput[] {
  return rows.map((r) => ({
    date: r.date as Date,
    description: r.description,
    amount: r.amount,
    isCredit: r.isCredit,
    installment: r.installment ?? null,
    totalInstallments: r.totalInstallments ?? null,
  }));
}

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  await getViewer();
  const file = formData.get("file") as File | null;
  const cardId = (formData.get("cardId") as string) || null;
  const accountId = (formData.get("accountId") as string) || null;
  const referenceInput = parseReferenceInput((formData.get("reference") as string) || null);
  if (!file) return { ok: false, error: "Arquivo ausente." };

  let diag: ParseDiagnostics;
  try {
    diag = await parseFile(file);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao ler arquivo." };
  }

  const card = cardId
    ? await prisma.creditCard.findUnique({ where: { id: cardId } })
    : null;

  const validRows = diag.rows.filter((r) => !r.reason && r.date);
  const reference = card
    ? referenceInput ?? inferReference(validRows, card)
    : null;

  const analysis = await analyzeImportRows({
    rows: toEngineRows(validRows),
    cardId: card?.id ?? null,
    accountId,
    holderId: card?.holderId ?? null,
    reference,
  });

  // Mescla resultados de volta na ordem original do arquivo
  const analyzedQueue = [...analysis.rows];
  const rows: PreviewRow[] = diag.rows.map((r) => {
    if (r.reason || !r.date) {
      return {
        date: r.date,
        description: r.description,
        amount: r.amount,
        isCredit: r.isCredit,
        installment: r.installment,
        totalInstallments: r.totalInstallments,
        duplicate: false,
        hash: "",
        reason: r.reason,
      };
    }
    const a = analyzedQueue.shift()!;
    return {
      date: r.date,
      description: r.description,
      amount: r.amount,
      isCredit: r.isCredit,
      installment: r.installment,
      totalInstallments: r.totalInstallments,
      duplicate: a.duplicate,
      hash: a.hash,
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
    total: diag.totalLines,
    valid: diag.validLines,
    ignored: diag.ignoredLines,
    duplicates: analysis.duplicates,
    detectedColumns: diag.detectedColumns,
    rawSample: diag.rawSample,
    parsedSample: diag.parsedSample,
    ignoredReasons: diag.ignoredReasons,
    rows,
    suggestedReference: reference,
  };
}

export type CommitResult =
  | {
      ok: true;
      total: number;
      imported: number;
      duplicates: number;
      ignored: number;
      batchId: string;
      reference: ImportReference | null;
    }
  | { ok: false; error: string };

export async function commitImport(formData: FormData): Promise<CommitResult> {
  await getViewer();
  const file = formData.get("file") as File | null;
  const cardId = (formData.get("cardId") as string) || null;
  const accountId = (formData.get("accountId") as string) || null;
  const referenceInput = parseReferenceInput((formData.get("reference") as string) || null);
  if (!file) return { ok: false, error: "Arquivo ausente." };

  let diag: ParseDiagnostics;
  try {
    diag = await parseFile(file);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao ler arquivo." };
  }

  if (diag.validLines === 0) {
    const cols = diag.detectedColumns;
    const detected = [
      cols.date && `data="${cols.date}"`,
      cols.description && `descrição="${cols.description}"`,
      cols.amount && `valor="${cols.amount}"`,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      ok: false,
      error: `Lemos ${diag.totalLines} linhas, mas nenhuma tinha data/descrição/valor reconhecíveis. Colunas encontradas: ${
        detected || "nenhuma reconhecida"
      }. Pré-visualize antes para investigar.`,
    };
  }

  const card = cardId
    ? await prisma.creditCard.findUnique({ where: { id: cardId } })
    : null;
  if (cardId && !card) return { ok: false, error: "Cartão não encontrado." };

  const validRows = diag.rows.filter((r) => !r.reason && r.date);
  const reference = card
    ? referenceInput ?? inferReference(validRows, card)
    : null;

  const analysis = await analyzeImportRows({
    rows: toEngineRows(validRows),
    cardId: card?.id ?? null,
    accountId,
    holderId: card?.holderId ?? null,
    reference,
  });

  const outcome = await commitAnalyzedRows(analysis, {
    source: file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv",
    fileName: file.name,
    card,
    accountId,
    reference,
  });

  revalidatePath("/transacoes");
  revalidatePath("/dashboard");
  revalidatePath("/cartoes");
  if (cardId) {
    revalidatePath("/cartoes");
    revalidatePath(`/cartoes/${cardId}`);
  }

  return {
    ok: true,
    batchId: outcome.batchId,
    imported: outcome.imported,
    duplicates: outcome.duplicates,
    ignored: diag.ignoredLines,
    total: diag.totalLines,
    reference: outcome.reference,
  };
}

/**
 * Exclui (desfaz) uma importação inteira: remove as transações do lote
 * (com recebíveis vinculados), recalcula as faturas afetadas — e apaga a
 * fatura que ficar vazia e sem pagamento registrado.
 */
export async function deleteImportBatch(id: string) {
  await getViewer();
  const batch = await prisma.importBatch.findUnique({
    where: { id },
    select: { id: true, cardId: true },
  });
  if (!batch) return;

  const txs = await prisma.transaction.findMany({
    where: { importBatchId: id },
    select: { id: true, invoiceId: true },
  });
  const txIds = txs.map((t) => t.id);
  const invoiceIds = Array.from(
    new Set(txs.map((t) => t.invoiceId).filter(Boolean))
  ) as string[];

  await prisma.$transaction([
    prisma.receivable.deleteMany({ where: { transactionId: { in: txIds } } }),
    prisma.transaction.deleteMany({ where: { id: { in: txIds } } }),
    prisma.importBatch.delete({ where: { id } }),
  ]);

  // Faturas afetadas: recalcula; se ficou vazia e sem pagamento, remove.
  for (const invId of invoiceIds) {
    const [remaining, inv] = await Promise.all([
      prisma.transaction.count({ where: { invoiceId: invId } }),
      prisma.creditCardInvoice.findUnique({ where: { id: invId } }),
    ]);
    if (!inv) continue;
    if (remaining === 0 && inv.paid <= 0) {
      await prisma.creditCardInvoice.delete({ where: { id: invId } });
    } else {
      await recalcInvoiceTotal(invId);
    }
  }

  revalidatePath("/cartoes");
  revalidatePath("/transacoes");
  revalidatePath("/cartoes");
  if (batch.cardId) revalidatePath(`/cartoes/${batch.cardId}`);
  revalidatePath("/dashboard");
}
