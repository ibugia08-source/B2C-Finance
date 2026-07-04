import { prisma } from "@/lib/prisma";
import type { CreditCard, Prisma } from "@prisma/client";
import {
  importedLineHash,
  transactionHash,
  installmentGroupKeyFor,
} from "@/lib/services/hash";
import {
  loadRuleContext,
  applyRulesSync,
  type RuleContext,
} from "@/lib/services/rules";
import {
  ensureInvoiceForReference,
  recalcInvoiceTotal,
  referenceKey,
} from "@/lib/services/invoices";

/**
 * Motor de importação em LOTE.
 *
 * Princípios:
 *  1. Zero N+1 — todas as consultas auxiliares (regras, categorias, hashes
 *     existentes, histórico de parcelas, cartões da conta) são feitas UMA vez.
 *  2. Fatura âncora — todas as linhas do arquivo entram na fatura real
 *     informada/detectada; nada é re-bucketizado pela data da compra e nenhuma
 *     fatura futura é criada.
 *  3. Parcela é metadado (installmentNumber/installmentTotal) — nenhuma
 *     parcela futura é gravada no banco.
 *  4. Reconhecimento histórico — parcela N+1 de uma compra já catalogada
 *     herda categoria/pessoa/contexto e é marcada com historyMatched.
 *  5. Dedup em camadas — hash v2 (escopado à fatura + ocorrência), hash v1
 *     legado (importações antigas) e grupo+número de parcela.
 */

export type ImportRowInput = {
  date: Date;
  description: string;
  amount: number; // sempre positivo
  isCredit?: boolean; // estorno/crédito
  installment?: number | null;
  totalInstallments?: number | null;
  cardLastDigits?: string | null; // final do cartão detectado na fatura
};

export type AnalyzedRow = {
  input: ImportRowInput;
  hash: string;
  legacyHash: string;
  groupKey: string | null;
  duplicate: boolean;
  duplicateReason: "hash" | "parcela" | null;
  historyMatched: boolean;
  categoryId: string | null;
  responsibleId: string | null;
  belongsTo: string;
  reimbursable: boolean;
  status: string;
  accountCardId: string | null;
};

export type ImportReference = { referenceMonth: number; referenceYear: number };

export type ImportAnalysis = {
  rows: AnalyzedRow[];
  duplicates: number;
  categoryNameById: Map<string, string>;
  personNameById: Map<string, string>;
  ruleContext: RuleContext;
};

export async function analyzeImportRows(opts: {
  rows: ImportRowInput[];
  cardId: string | null;
  accountId: string | null;
  holderId?: string | null; // titular do cartão (p/ status devendo)
  reference: ImportReference | null; // null = extrato de conta (sem fatura)
}): Promise<ImportAnalysis> {
  const { rows, cardId, accountId, holderId, reference } = opts;
  const refKey = reference
    ? referenceKey(reference.referenceYear, reference.referenceMonth)
    : null;

  // --- chaves calculadas em memória -------------------------------------
  const occurrenceCounter = new Map<string, number>();
  const computed = rows.map((r) => {
    const occKey = `${r.date.toISOString().slice(0, 10)}|${r.description.toUpperCase()}|${Math.round(
      r.amount * 100
    )}`;
    const occurrence = occurrenceCounter.get(occKey) ?? 0;
    occurrenceCounter.set(occKey, occurrence + 1);

    const hash = importedLineHash({
      date: r.date,
      description: r.description,
      amount: r.amount,
      cardId,
      accountId,
      referenceKey: refKey,
      installmentNumber: r.installment ?? null,
      installmentTotal: r.totalInstallments ?? null,
      occurrence,
    });
    const legacyHash = transactionHash({
      date: r.date,
      description: r.description,
      amount: r.amount,
      cardId,
      accountId,
    });
    const groupKey =
      r.totalInstallments && r.totalInstallments > 1
        ? installmentGroupKeyFor({
            cardId,
            description: r.description,
            amount: r.amount,
            installmentTotal: r.totalInstallments,
          })
        : null;
    return { input: r, hash, legacyHash, groupKey };
  });

  const allHashes = computed.flatMap((c) => [c.hash, c.legacyHash]);
  const allGroupKeys = Array.from(
    new Set(computed.map((c) => c.groupKey).filter(Boolean))
  ) as string[];

  // --- consultas auxiliares em lote (1 round-trip cada, em paralelo) -----
  const [existingByHash, groupHistory, ruleContext, categories, people, accountCards] =
    await Promise.all([
      allHashes.length
        ? prisma.transaction.findMany({
            where: { hash: { in: allHashes } },
            select: { hash: true },
          })
        : Promise.resolve([] as { hash: string | null }[]),
      allGroupKeys.length
        ? prisma.transaction.findMany({
            where: { installmentGroupKey: { in: allGroupKeys } },
            select: {
              installmentGroupKey: true,
              installmentNumber: true,
              categoryId: true,
              responsibleId: true,
              belongsTo: true,
              reimbursable: true,
              status: true,
              date: true,
            },
            orderBy: { date: "asc" },
          })
        : Promise.resolve(
            [] as {
              installmentGroupKey: string | null;
              installmentNumber: number | null;
              categoryId: string | null;
              responsibleId: string | null;
              belongsTo: string;
              reimbursable: boolean;
              status: string;
              date: Date;
            }[]
          ),
      loadRuleContext(),
      prisma.category.findMany({ select: { id: true, name: true } }),
      prisma.person.findMany({ select: { id: true, name: true } }),
      cardId
        ? prisma.accountCard.findMany({
            where: { cardId },
            select: { id: true, lastDigits: true },
          })
        : Promise.resolve([] as { id: string; lastDigits: string | null }[]),
    ]);

  const existingHashes = new Set(existingByHash.map((t) => t.hash));

  // histórico por grupo: números já importados + parcela mais recente
  const groupInfo = new Map<
    string,
    { numbers: Set<number>; latest: (typeof groupHistory)[number] }
  >();
  for (const g of groupHistory) {
    if (!g.installmentGroupKey) continue;
    const info =
      groupInfo.get(g.installmentGroupKey) ??
      ({ numbers: new Set<number>(), latest: g } as {
        numbers: Set<number>;
        latest: (typeof groupHistory)[number];
      });
    if (g.installmentNumber != null) info.numbers.add(g.installmentNumber);
    // orderBy date asc → o último iterado é o mais recente
    info.latest = g;
    groupInfo.set(g.installmentGroupKey, info);
  }

  const accountCardByDigits = new Map(
    accountCards.filter((c) => c.lastDigits).map((c) => [c.lastDigits as string, c.id])
  );

  // --- análise linha a linha (memória pura) ------------------------------
  let duplicates = 0;
  const analyzed: AnalyzedRow[] = computed.map(({ input, hash, legacyHash, groupKey }) => {
    let duplicate = false;
    let duplicateReason: AnalyzedRow["duplicateReason"] = null;

    if (existingHashes.has(hash) || existingHashes.has(legacyHash)) {
      duplicate = true;
      duplicateReason = "hash";
    } else if (
      groupKey &&
      input.installment != null &&
      groupInfo.get(groupKey)?.numbers.has(input.installment)
    ) {
      // Mesma parcela (ex.: 3/10) da mesma compra já existe no banco —
      // provável reimportação com data/arquivo levemente diferente.
      duplicate = true;
      duplicateReason = "parcela";
    }
    if (duplicate) duplicates++;

    // Regras genéricas
    const effects = applyRulesSync(ruleContext, {
      description: input.description,
      cardId,
      amount: input.amount,
    });

    // Reconhecimento histórico (prioridade sobre regras): herda organização
    // da parcela anterior da mesma compra.
    let historyMatched = false;
    let categoryId = effects.categoryId ?? null;
    let responsibleId = effects.responsibleId ?? null;
    let belongsTo = effects.belongsTo ?? "pessoal";
    let reimbursable = effects.reimbursable ?? false;
    let status = effects.status ?? "pendente";

    const latest = groupKey ? groupInfo.get(groupKey)?.latest : undefined;
    if (latest && !duplicate) {
      historyMatched = true;
      if (latest.categoryId) categoryId = latest.categoryId;
      if (latest.responsibleId) responsibleId = latest.responsibleId;
      if (latest.belongsTo) belongsTo = latest.belongsTo;
      reimbursable = latest.reimbursable;
      // Nova parcela de compra de terceiro nasce "devendo" (a receber);
      // demais casos seguem o padrão.
      const isThirdParty =
        !!latest.responsibleId && !!holderId && latest.responsibleId !== holderId;
      if (isThirdParty || latest.status === "devendo") status = "devendo";
    }

    const accountCardId = input.cardLastDigits
      ? accountCardByDigits.get(input.cardLastDigits) ?? null
      : null;

    return {
      input,
      hash,
      legacyHash,
      groupKey,
      duplicate,
      duplicateReason,
      historyMatched,
      categoryId,
      responsibleId,
      belongsTo,
      reimbursable,
      status,
      accountCardId,
    };
  });

  return {
    rows: analyzed,
    duplicates,
    categoryNameById: new Map(categories.map((c) => [c.id, c.name])),
    personNameById: new Map(people.map((p) => [p.id, p.name])),
    ruleContext,
  };
}

export type CommitOptions = {
  source: string; // csv | xlsx | pdf
  fileName: string | null;
  card: CreditCard | null; // fatura âncora quando presente
  accountId: string | null;
  reference: ImportReference | null;
  detected?: { closingDate?: Date; dueDate?: Date; declaredTotal?: number };
};

export type CommitOutcome = {
  batchId: string;
  imported: number;
  duplicates: number;
  invoiceId: string | null;
  reference: ImportReference | null;
};

/**
 * Grava as linhas analisadas em LOTE:
 *  batch + fatura âncora + createMany das transações + recebíveis herdados
 *  + 1 único recálculo de total no final. ~8 queries no total.
 */
export async function commitAnalyzedRows(
  analysis: ImportAnalysis,
  opts: CommitOptions
): Promise<CommitOutcome> {
  const { card, accountId, reference } = opts;
  const cardId = card?.id ?? null;

  // Fatura real âncora (apenas quando importando para uma conta/cartão)
  const invoice =
    card && reference
      ? await ensureInvoiceForReference(
          card,
          reference.referenceMonth,
          reference.referenceYear,
          opts.detected ?? {}
        )
      : null;

  const batch = await prisma.importBatch.create({
    data: {
      source: opts.source,
      fileName: opts.fileName,
      cardId,
      accountId,
      invoiceId: invoice?.id ?? null,
      referenceMonth: reference?.referenceMonth ?? null,
      referenceYear: reference?.referenceYear ?? null,
      total: analysis.rows.length,
    },
  });

  const toCreate = analysis.rows.filter((r) => !r.duplicate);

  const data: Prisma.TransactionCreateManyInput[] = toCreate.map((r) => {
    // Cartão: compras = despesa; estornos (crédito) = ajuste.
    // Conta: crédito = receita; débito = despesa.
    const type = cardId
      ? r.input.isCredit
        ? "ajuste"
        : "despesa"
      : r.input.isCredit
        ? "receita"
        : "despesa";

    return {
      date: r.input.date,
      description: r.input.description,
      amount: r.input.amount,
      type,
      origin: cardId ? "cartao" : "pix",
      cardId,
      accountId,
      categoryId: r.categoryId,
      responsibleId: r.responsibleId,
      belongsTo: r.belongsTo,
      status: r.status,
      reimbursable: r.reimbursable,
      importBatchId: batch.id,
      invoiceId: invoice?.id ?? null,
      installmentNumber: r.input.installment ?? null,
      installmentTotal: r.input.totalInstallments ?? null,
      installmentGroupKey: r.groupKey,
      historyMatched: r.historyMatched,
      accountCardId: r.accountCardId,
      hash: r.hash,
    };
  });

  let created: {
    id: string;
    responsibleId: string | null;
    amount: number;
    date: Date;
    status: string;
  }[] = [];
  if (data.length > 0) {
    created = await prisma.transaction.createManyAndReturn({
      data,
      skipDuplicates: true, // rede extra de segurança via unique(hash)
      select: { id: true, responsibleId: true, amount: true, date: true, status: true },
    });
  }

  // Recebíveis para parcelas herdadas atribuídas a terceiros (mesma semântica
  // de setTransactionResponsible), criados em lote.
  const holderId = card?.holderId ?? null;
  const receivablesToCreate = created
    .filter(
      (t) => t.status === "devendo" && t.responsibleId && t.responsibleId !== holderId
    )
    .map((t) => ({
      personId: t.responsibleId as string,
      transactionId: t.id,
      amount: t.amount,
      dueDate: invoice?.dueDate ?? t.date,
      status: "aberto",
    }));
  if (receivablesToCreate.length > 0) {
    await prisma.receivable.createMany({ data: receivablesToCreate });
  }

  const [batchUpdated] = await Promise.all([
    prisma.importBatch.update({
      where: { id: batch.id },
      data: { imported: created.length, duplicates: analysis.duplicates },
    }),
    invoice ? recalcInvoiceTotal(invoice.id) : Promise.resolve(null),
  ]);

  return {
    batchId: batchUpdated.id,
    imported: created.length,
    duplicates: analysis.duplicates,
    invoiceId: invoice?.id ?? null,
    reference,
  };
}
