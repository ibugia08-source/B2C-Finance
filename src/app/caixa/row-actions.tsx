"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ContaDialog } from "./conta-dialog";
import { excluirConta } from "@/lib/actions/contas";

export type ContaDaLinha = {
  id: string;
  name: string;
  bank: string | null;
  type: string;
  balance: string;
  active: boolean;
};

/**
 * Ações da linha. A destrutiva fica SEPARADA da edição e leva rótulo com o
 * nome do registro (DS-08): a auditoria achou linhas financeiras onde o ícone
 * de pagar dava lugar à lixeira na mesma posição, e rótulos acessíveis que
 * não diziam de qual registro se tratava.
 */
export function ContaActions({ conta }: { conta: ContaDaLinha }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();

  async function excluir() {
    const ok = await confirmAction({
      title: `Excluir a conta ${conta.name}?`,
      description:
        "Só dá para excluir conta sem nenhum lançamento. Se ela já tem movimento, desative-a — o histórico precisa dela para conciliar.",
      confirmLabel: "Excluir conta",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      setErro(null);
      const r = await excluirConta(conta.id);
      if (r.ok) router.refresh();
      else setErro(r.error);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {erro && (
        <span role="alert" className="mr-2 text-caption text-danger-ink">
          {erro}
        </span>
      )}
      <ContaDialog
        initial={conta}
        trigger={
          <Button variant="ghost" size="icon" aria-label={`Editar conta ${conta.name}`}>
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        disabled={pendente}
        onClick={excluir}
        aria-label={`Excluir conta ${conta.name}`}
      >
        <Trash2 className="h-4 w-4 text-danger-ink" aria-hidden />
      </Button>
    </div>
  );
}
