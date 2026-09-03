"use client";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContractDialog } from "./contract-dialog";
import { Pencil, Trash2, RefreshCw, Square, Receipt } from "lucide-react";
import {
  deleteContract,
  endContract,
  generateContractBillings,
} from "@/lib/actions/contracts";

export function ContractActions({
  contract,
  clients,
  services,
}: {
  contract: any;
  clients: { id: string; name: string }[];
  services: any[];
}) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const live = ["ACTIVE", "RENEWAL", "OVERDUE", "PENDING"].includes(contract.status);

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex gap-1 justify-end">
        {live && (
          <Button
            variant="ghost"
            size="icon"
            title="Gerar cobranças deste contrato"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await generateContractBillings(contract.id);
                setFeedback(
                  res.ok
                    ? `${res.created ?? 0} cobrança(s) gerada(s)`
                    : res.error
                );
              })
            }
          >
            <Receipt className="h-4 w-4" />
          </Button>
        )}
        {/* Renovação SÓ pelo fluxo oficial (módulo Renovações): o atalho
            antigo estendia o contrato sem registrar ClientRenewal, sem
            atualizar o cadastro e sem lançar cobrança — o cliente seguia
            "Pendente" no painel e o time renovava em dobro (aud. 13/08). */}
        {live && (
          <Button variant="ghost" size="icon" title="Renovar (abre o módulo Renovações)" asChild>
            <Link href="/renovacoes">
              <RefreshCw className="h-4 w-4" />
            </Link>
          </Button>
        )}
        <ContractDialog
          clients={clients}
          services={services}
          initial={contract}
          trigger={
            <Button variant="ghost" size="icon" title="Editar">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
        {live && (
          <Button
            variant="ghost"
            size="icon"
            title="Encerrar contrato"
            disabled={pending}
            onClick={async () => {
              if (!(await confirmAction({ title: `Encerrar o contrato "${contract.title}"?`, destructive: true }))) return;
              start(async () => {
                const res = await endContract(contract.id);
                if (!res.ok) setFeedback(res.error);
              });
            }}
          >
            <Square className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          title="Excluir"
          disabled={pending}
          onClick={async () => {
            if (
              !(await confirmAction({
                title: `Excluir o contrato "${contract.title}"?`,
                description: "Contratos que já têm cobranças devem ser cancelados, não excluídos.",
                confirmLabel: "Excluir contrato",
                destructive: true,
              }))
            )
              return;
            start(async () => {
              const res = await deleteContract(contract.id);
              if (!res.ok) setFeedback(res.error);
            });
          }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {feedback && (
        <p className="text-xs text-muted-foreground max-w-[220px] text-right">
          {feedback}
        </p>
      )}
    </div>
  );
}

