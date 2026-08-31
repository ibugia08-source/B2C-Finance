"use client";
import { useState, useTransition } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { showUndoToast } from "@/components/undo-toast";
import { encerrarPendenciaAction } from "@/lib/actions/import-review";
import { formatDateBR } from "@/lib/format";
import type { ItemRevisao } from "@/lib/services/import-review";

/**
 * FILA DE REVISÃO (F1.21 · 03 §3.3).
 *
 * Duas saídas, e elas NÃO são a mesma coisa: "Arrumei" (fui lá e corrigi) e
 * "Está certo assim" (olhei e o dado é esse mesmo). Guardar as duas separadas
 * é o que permite responder, daqui a seis meses, por que aquele cliente está
 * sem valor — se foi decisão ou descuido.
 */
export function ReviewQueue({ itens }: { itens: ItemRevisao[] }) {
  const [lista, setLista] = useState(itens);
  const [pending, start] = useTransition();

  if (lista.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Check}
            title="Nada para revisar"
            description="Toda linha importada entrou com o que precisava. Quando alguma vier incompleta ou ambígua, ela aparece aqui em vez de virar número oficial calada."
          />
        </CardContent>
      </Card>
    );
  }

  function encerrar(item: ItemRevisao, como: "RESOLVIDO" | "DESCARTADO") {
    setLista((l) => l.filter((x) => x.id !== item.id));
    start(async () => {
      await encerrarPendenciaAction(item.id, como);
      showUndoToast({
        message:
          como === "RESOLVIDO"
            ? `"${item.rotulo}" marcada como arrumada.`
            : `"${item.rotulo}" aceita como está.`,
      });
    });
  }

  return (
    <Card>
      <CardContent className="divide-y divide-border-soft p-0">
        {lista.map((item) => (
          <div key={item.id} className="flex flex-wrap items-start gap-3 p-3.5">
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning-soft"
              aria-hidden
            >
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium">
                {item.rotulo}
                <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                  {item.entity}
                </Badge>
              </p>
              <p className="mt-0.5 text-dense text-muted-foreground">{item.motivo}</p>
              <p className="mt-1 text-caption text-muted-foreground">
                linha {item.sourceRow}
                {item.arquivo ? ` de ${item.arquivo}` : ""} · importada em{" "}
                {formatDateBR(item.quando)}
                {item.entityId ? "" : " · não chegou a ser gravada"}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => encerrar(item, "RESOLVIDO")}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                Arrumei
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => encerrar(item, "DESCARTADO")}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Está certo assim
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
