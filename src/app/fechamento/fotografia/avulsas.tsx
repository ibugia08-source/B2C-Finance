"use client";
import { useState, useTransition } from "react";
import { Camera, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { askReason } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { criarFotografiaAvulsaAction } from "@/lib/actions/closing";
import { formatDateBR } from "@/lib/format";

/**
 * FOTOGRAFIAS AVULSAS (F2.9 · 01 §5.7).
 *
 * "Nomeada, por permissão, SEM fechar período."
 *
 * O uso real: congelar o mês antes de um gesto grande — uma renegociação em
 * massa, um write-off, uma correção de importação — para poder voltar e
 * comparar. Ela nunca vira a fotografia vigente do mês; a nativa continua
 * sendo a do fechamento.
 */
export function Avulsas({
  competence,
  lista,
  podeCriar,
}: {
  competence: string;
  lista: {
    id: string;
    name: string;
    closedBy: string | null;
    createdAt: Date;
    checksum: string;
  }[];
  podeCriar: boolean;
}) {
  const [itens, setItens] = useState(lista);
  const [pending, start] = useTransition();

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-body font-medium">Fotografias avulsas</p>
            <p className="text-dense text-muted-foreground">
              Congele o mês antes de um gesto grande e volte para comparar. Não
              fecha o mês nem substitui a fotografia do fechamento.
            </p>
          </div>
          {podeCriar ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={async () => {
                const nome = await askReason({
                  title: "Congelar o mês agora",
                  description:
                    "Guarda como o mês está neste instante, sem fechá-lo. Dê um nome que você reconheça depois.",
                  confirmLabel: "Congelar",
                  motivo: {
                    label: "Nome desta fotografia",
                    placeholder: "Ex.: antes da renegociação da Alfa",
                    minimo: 3,
                  },
                });
                if (!nome) return;
                start(async () => {
                  const r = await criarFotografiaAvulsaAction(competence, nome);
                  if (!r.ok) {
                    showUndoToast({ message: r.error });
                    return;
                  }
                  setItens((l) => [
                    { id: r.id, name: nome, closedBy: null, createdAt: new Date(), checksum: r.checksum },
                    ...l,
                  ]);
                  showUndoToast({ message: `"${nome}" guardada.` });
                });
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Congelar agora
            </Button>
          ) : null}
        </div>

        {itens.length === 0 ? (
          <p className="py-3 text-dense text-muted-foreground">
            Nenhuma fotografia avulsa deste mês.
          </p>
        ) : (
          <ul className="divide-y divide-border-soft">
            {itens.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                <Camera className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="flex-1 text-body font-medium">{f.name}</span>
                <span className="text-caption text-muted-foreground">
                  {formatDateBR(f.createdAt)}
                  {f.closedBy ? ` · ${f.closedBy}` : ""}
                </span>
                <code className="font-mono text-caption text-text-faint">
                  {f.checksum.slice(0, 10)}
                </code>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
