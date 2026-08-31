"use client";
import { useTransition } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { fecharPeriodoAction, iniciarFechamentoAction } from "@/lib/actions/closing";
import type { EstadoDePeriodo } from "@/lib/periods/events";

/**
 * ASSISTENTE DE ROTINA MENSAL (F2.2 · ref. 02 §4.6).
 *
 * "Dia 1 abre competência e inicia o fechamento guiado do anterior; dias 1-5
 * checklist com dono e link; SOFT_CLOSED antes do definitivo."
 *
 * O assistente é uma frase e um botão, não um passo a passo de seis telas: a
 * cadência já está na cabeça de quem fecha o mês; o que falta é o sistema
 * dizer em que ponto dela a pessoa está e qual é o próximo gesto.
 *
 * SOFT_CLOSED antes do definitivo é obrigatório aqui de propósito — o botão
 * "Fechar" só aparece depois de "Iniciar fechamento". Pular a etapa
 * intermediária é o que faz alguém fechar o mês sem olhar a lista.
 */
export function RotinaMensal({
  competence,
  estado,
}: {
  competence: string;
  estado: EstadoDePeriodo;
}) {
  const [pending, start] = useTransition();

  const passo =
    estado === "CLOSED"
      ? {
          titulo: "Mês fechado",
          texto:
            "A leitura executiva do mês fechado fica na fotografia. Recebimentos de cobranças antigas continuam entrando normalmente, no mês em que o dinheiro cair.",
          botao: null,
        }
      : estado === "SOFT_CLOSED"
        ? {
            titulo: "Em fechamento — dias 1 a 5",
            texto:
              "Resolva o que a lista aponta abaixo. Enquanto o mês está em fechamento, só as pendências do próprio fechamento entram.",
            botao: "fechar" as const,
          }
        : {
            titulo: estado === "REOPENED" ? "Reaberto para correção" : "Mês aberto",
            texto:
              "Comece o fechamento quando o mês tiver terminado. Isso trava lançamentos comuns e deixa passar só as pendências da lista.",
            botao: "iniciar" as const,
          };

  return (
    <Card className="mb-4 border-brand/25 bg-brand-subtle/40">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised"
            aria-hidden
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </span>
          <div>
            <p className="text-body font-medium">{passo.titulo}</p>
            <p className="mt-0.5 max-w-2xl text-dense text-muted-foreground">{passo.texto}</p>
          </div>
        </div>

        {passo.botao === "iniciar" ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await iniciarFechamentoAction(competence);
                showUndoToast({ message: "Fechamento iniciado." });
              })
            }
          >
            Iniciar fechamento
          </Button>
        ) : passo.botao === "fechar" ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={async () => {
              const ok = await confirmAction({
                title: "Fechar este mês?",
                description:
                  "O que estiver pendente na lista fica registrado como pendente no fechamento. Depois disso, o resultado do mês só muda com uma reabertura justificada.",
                confirmLabel: "Fechar o mês",
              });
              if (!ok) return;
              start(async () => {
                await fecharPeriodoAction(competence);
                showUndoToast({ message: "Mês fechado." });
              });
            }}
          >
            Fechar o mês
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
