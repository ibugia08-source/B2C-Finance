"use client";
import { useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { askReason } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { marcarReconferidoAction } from "@/lib/actions/closing";
import { formatDateBR } from "@/lib/format";

/**
 * POR QUE ESTE MÊS PRECISA SER RECONFERIDO (F2.6 · 01 §5.5).
 *
 * A marca sozinha vira ruído. Aqui ela vem com o motivo, a competência que
 * foi reaberta, quem reabriu e quando — e com a saída: alguém confere e diz
 * que continua valendo.
 *
 * A saída EXIGE nota porque "conferi e está certo" é uma afirmação de
 * responsabilidade, não um clique de limpar.
 */
export function Reconferir({
  competence,
  motivos,
}: {
  competence: string;
  motivos: {
    dependsOnCompetence: string;
    originVersion: number;
    reason: string;
    markedBy: string | null;
    markedAt: Date;
  }[];
}) {
  const [pending, start] = useTransition();
  const [pronto, setPronto] = useState(false);
  if (pronto) return null;

  return (
    <Card className="mb-4 border-warning/30 bg-warning-soft">
      <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/20">
            <TriangleAlert className="h-4 w-4 text-warning" aria-hidden />
          </span>
          <div>
            <p className="text-body font-medium text-warning-foreground">
              Este mês merece uma reconferida
            </p>
            <ul className="mt-1 space-y-1">
              {motivos.map((m, i) => (
                <li key={i} className="text-dense text-warning-foreground/90">
                  {m.dependsOnCompetence} foi reaberto (versão {m.originVersion})
                  {m.markedBy ? ` por ${m.markedBy}` : ""} em {formatDateBR(m.markedAt)}:
                  <span className="italic"> “{m.reason}”</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-caption text-warning-foreground/80">
              Os números deste mês foram calculados sobre um passado que mudou
              depois. Eles não foram apagados — só precisam de uma segunda
              olhada.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={async () => {
            const nota = await askReason({
              title: "Conferido?",
              description:
                "A marca sai deste mês. Fica registrado quem conferiu, quando e o que conferiu.",
              confirmLabel: "Conferido",
              motivo: {
                label: "O que você conferiu?",
                placeholder: "Ex.: refiz o resultado do mês e bate com o fechamento",
              },
            });
            if (!nota) return;
            start(async () => {
              const r = await marcarReconferidoAction(competence, nota);
              if (!r.ok) {
                showUndoToast({ message: r.error });
                return;
              }
              setPronto(true);
              showUndoToast({ message: "Mês reconferido." });
            });
          }}
        >
          Conferi, continua valendo
        </Button>
      </CardContent>
    </Card>
  );
}
