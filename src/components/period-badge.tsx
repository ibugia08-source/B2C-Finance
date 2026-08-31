"use client";
import { useState, useTransition } from "react";
import { CalendarCheck, CalendarClock, Lock, RotateCcw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { askReason, confirmAction } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import {
  fecharPeriodoAction, iniciarFechamentoAction, reabrirPeriodoAction,
  voltarParaOperacaoAction,
} from "@/lib/actions/closing";
import type { PeriodoInfo } from "@/lib/services/closing-period";

/**
 * ESTADO DO MÊS NO CABEÇALHO (F1.15 · 02 §5.2 · F2.1).
 *
 * Era a peça que faltava na F1.15 e que só podia existir depois do
 * ClosingPeriod. Sem ela, quem abre a Gestão do Mês não tem como saber se
 * está olhando um mês vivo ou um mês que já virou história — e edita achando
 * que pode.
 *
 * Os nomes técnicos não aparecem (01 §5.2): Aberto, Em fechamento, Fechado,
 * Reaberto.
 */
export function PeriodBadge({
  periodo,
  podeFechar,
  podeReabrir,
}: {
  periodo: PeriodoInfo;
  podeFechar: boolean;
  podeReabrir: boolean;
}) {
  const [estado, setEstado] = useState(periodo);
  const [pending, start] = useTransition();

  const visual = {
    OPEN: { variant: "outline" as const, Icone: CalendarClock },
    SOFT_CLOSED: { variant: "warning" as const, Icone: CalendarCheck },
    CLOSED: { variant: "secondary" as const, Icone: Lock },
    REOPENED: { variant: "warning" as const, Icone: RotateCcw },
  }[estado.estado];
  const Icone = visual.Icone;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={visual.variant} className="gap-1">
        <Icone className="h-3 w-3" aria-hidden />
        {estado.rotulo}
        {estado.versao > 1 ? ` · v${estado.versao}` : ""}
      </Badge>

      {estado.precisaRevalidar ? (
        <span
          className="inline-flex items-center gap-1 text-caption text-warning"
          title="Um mês anterior foi reaberto depois deste fechamento. Os números daqui foram calculados sobre um passado que mudou."
        >
          <TriangleAlert className="h-3 w-3" aria-hidden />
          reconferir
        </span>
      ) : null}

      {podeFechar && (estado.estado === "OPEN" || estado.estado === "REOPENED") ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-caption"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await iniciarFechamentoAction(estado.competence);
              setEstado((e) => ({ ...e, estado: r.estado, rotulo: r.rotulo }));
              showUndoToast({
                message: "Mês em fechamento. Só as pendências do fechamento entram agora.",
                onUndo: async () => {
                  const v = await voltarParaOperacaoAction(estado.competence);
                  setEstado((e) => ({ ...e, estado: v.estado, rotulo: v.rotulo }));
                },
              });
            })
          }
        >
          Iniciar fechamento
        </Button>
      ) : null}

      {podeFechar && estado.estado === "SOFT_CLOSED" ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-caption"
          disabled={pending}
          onClick={async () => {
            const ok = await confirmAction({
              title: "Fechar este mês?",
              description:
                "Depois de fechado, o resultado do mês não muda mais sem uma reabertura justificada. Recebimentos de cobranças antigas continuam normais — eles entram no mês em que o dinheiro cair.",
              confirmLabel: "Fechar o mês",
            });
            if (!ok) return;
            start(async () => {
              const r = await fecharPeriodoAction(estado.competence);
              setEstado((e) => ({ ...e, estado: r.estado, rotulo: r.rotulo }));
              showUndoToast({ message: "Mês fechado." });
            });
          }}
        >
          Fechar o mês
        </Button>
      ) : null}

      {podeReabrir && estado.estado === "CLOSED" ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-caption"
          disabled={pending}
          onClick={async () => {
            // Reabrir SEM justificativa não existe (§5.5). São TRÊS travas
            // no mesmo caminho, de propósito: o botão não confirma sem texto,
            // a action recusa, e o banco tem CHECK. Reabertura é o gesto que
            // reescreve o passado — não pode depender de uma tela só.
            const motivo = await askReason({
              title: "Reabrir este mês?",
              description:
                "Os meses posteriores já fechados ficam marcados para reconferência — os números deles foram calculados sobre este.",
              confirmLabel: "Reabrir",
              motivo: {
                label: "Por que este mês precisa ser reaberto?",
                placeholder: "Ex.: nota de agosto lançada em setembro por engano",
              },
            });
            if (!motivo) return;
            start(async () => {
              const r = await reabrirPeriodoAction(estado.competence, motivo);
              if (!r.ok) {
                showUndoToast({ message: r.error });
                return;
              }
              setEstado((e) => ({ ...e, estado: r.estado, rotulo: r.rotulo }));
              showUndoToast({
                message: r.marcados
                  ? `Mês reaberto. ${r.marcados} ${r.marcados === 1 ? "mês posterior ficou marcado" : "meses posteriores ficaram marcados"} para reconferência.`
                  : "Mês reaberto.",
              });
            });
          }}
        >
          Reabrir
        </Button>
      ) : null}
    </div>
  );
}
