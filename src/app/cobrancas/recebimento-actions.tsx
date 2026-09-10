"use client";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { formatBRL } from "@/lib/format";

/**
 * EXCLUIR UM RECEBIMENTO da lista "Recebimentos do Mês" (ajuste de erro
 * operacional: pagamento marcado como recebido por engano ou na data
 * errada).
 *
 * A linha diz COMO excluir via `alvo.via` — cada tipo de recebimento tem
 * um desfazer diferente, e é o servidor quem garante a consistência:
 *
 *  · "billing"  → estorna TODOS os pagamentos da cobrança pelo motor
 *                 oficial. A cobrança volta a Em aberto/Vencida, o valor
 *                 sai do caixa do mês do pagamento e a conciliação some.
 *  · "payment"  → estorna UM pagamento (linha de recuperação de mês
 *                 anterior): o caixa deste mês devolve o valor e a
 *                 cobrança reabre NA COMPETÊNCIA DELA.
 *  · "income"   → apaga uma entrada avulsa (sem cobrança por trás).
 *  · "extra"    → apaga uma receita extra manual.
 */
export type ExcluirRecebimento = {
  via: "billing" | "payment" | "income" | "extra";
  id: string;
};

const CONFIRMACAO: Record<
  ExcluirRecebimento["via"],
  { titulo: (nome: string, valor: string) => string; descricao: string; rotulo: string }
> = {
  billing: {
    titulo: (nome, valor) => `Excluir o pagamento de ${nome} (${valor})?`,
    descricao:
      'A cobrança volta a ficar em aberto (ou vencida) e o valor sai de "Recebido" no mês do pagamento. Não dá para desfazer.',
    rotulo: "Excluir pagamento",
  },
  payment: {
    titulo: (nome, valor) => `Excluir o recebimento de ${nome} (${valor})?`,
    descricao:
      "O valor sai do caixa deste mês e a cobrança volta a ficar em aberto (ou vencida) no mês dela. Não dá para desfazer.",
    rotulo: "Excluir recebimento",
  },
  income: {
    titulo: (nome, valor) => `Excluir a entrada ${nome} (${valor})?`,
    descricao: "A entrada avulsa sai do caixa do mês. Não dá para desfazer.",
    rotulo: "Excluir entrada",
  },
  extra: {
    titulo: (nome, valor) => `Excluir a receita extra ${nome} (${valor})?`,
    descricao: "A receita extra sai do caixa do mês. Não dá para desfazer.",
    rotulo: "Excluir receita extra",
  },
};

async function executar(alvo: ExcluirRecebimento): Promise<{ ok: boolean; error?: string }> {
  switch (alvo.via) {
    case "billing": {
      const { deleteBillingPayments } = await import("@/lib/actions/receivables-inline");
      return deleteBillingPayments(alvo.id);
    }
    case "payment": {
      const { deleteReceiptPayment } = await import("@/lib/actions/receivables-inline");
      return deleteReceiptPayment(alvo.id);
    }
    case "income": {
      const { deleteIncome } = await import("@/lib/actions/incomes");
      return deleteIncome(alvo.id);
    }
    case "extra": {
      const { deleteExtraRevenue } = await import("@/lib/actions/extra-revenues");
      return deleteExtraRevenue(alvo.id);
    }
  }
}

export function ExcluirRecebimentoButton({
  alvo,
  nome,
  valor,
}: {
  alvo: ExcluirRecebimento;
  nome: string;
  valor: number;
}) {
  const [pending, start] = useTransition();
  const c = CONFIRMACAO[alvo.via];

  async function run() {
    if (
      !(await confirmAction({
        title: c.titulo(nome, formatBRL(valor)),
        description: c.descricao,
        confirmLabel: c.rotulo,
        destructive: true,
      }))
    )
      return;
    start(async () => {
      const res = await executar(alvo);
      if (!res.ok) showUndoToast({ message: String(res.error ?? "Falha ao excluir.") });
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      title={c.rotulo}
      aria-label={`${c.rotulo} — ${nome}`}
      disabled={pending}
      onClick={run}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}
