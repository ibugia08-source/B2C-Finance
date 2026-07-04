"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { deleteInvoice } from "@/lib/actions/invoices";
import { deleteImportBatch } from "@/lib/actions/import";

/** Exclui uma fatura importada (e todas as suas transações). */
export function DeleteInvoiceButton({
  invoiceId,
  label,
}: {
  invoiceId: string;
  label: string; // ex.: "Junho / 2026 — Nubank Israel"
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      title="Excluir fatura e todas as suas transações"
      onClick={() => {
        if (
          !confirm(
            `Excluir a fatura ${label}?\n\nTodas as transações dessa fatura (e os valores a receber vinculados) serão apagados. Esta ação não pode ser desfeita.`
          )
        )
          return;
        start(() => deleteInvoice(invoiceId));
      }}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

/** Exclui (desfaz) um lote de importação inteiro. */
export function DeleteBatchButton({
  batchId,
  label,
}: {
  batchId: string;
  label: string; // ex.: nome do arquivo
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      title="Desfazer esta importação (apaga as transações importadas)"
      onClick={() => {
        if (
          !confirm(
            `Desfazer a importação "${label}"?\n\nTodas as transações importadas nesse lote serão apagadas e as faturas afetadas serão recalculadas. Esta ação não pode ser desfeita.`
          )
        )
          return;
        start(() => deleteImportBatch(batchId));
      }}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}
