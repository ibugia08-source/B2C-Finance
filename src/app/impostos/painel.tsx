"use client";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { showUndoToast } from "@/components/undo-toast";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { marcarReservaFeitaAction, provisionarAction } from "@/lib/actions/impostos";
import { formatBRL } from "@/lib/format";
import type { SugestaoDeProvisao } from "@/lib/services/tax-provision";

/**
 * Os dois eventos, lado a lado e nunca juntos (01 §3.8).
 */
export function PainelDeImpostos({
  competence,
  sugestoes,
  podeLancar,
}: {
  competence: string;
  sugestoes: SugestaoDeProvisao[];
  podeLancar: boolean;
}) {
  const [lista, setLista] = useState(sugestoes);
  const [pending, start] = useTransition();

  if (lista.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-dense text-muted-foreground">
          Nenhuma entidade cadastrada.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {lista.map((s) => (
        <Card key={s.legalEntityId}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-body font-medium">{s.legalEntityName}</p>
                {s.semAliquota ? (
                  <p className="mt-0.5 text-dense text-warning">
                    Sem alíquota efetiva configurada — sem ela não há o que
                    calcular, e inventar uma seria pior que não calcular.
                  </p>
                ) : (
                  <p className="mt-0.5 text-dense text-muted-foreground">
                    {formatBRL(s.base)} de base × {Number(s.aliquota).toFixed(2)}% ={" "}
                    <strong>{formatBRL(s.valor)}</strong>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {s.jaLancada ? (
                  <Badge variant="success">provisionado no resultado</Badge>
                ) : (
                  <Badge variant="outline">não provisionado</Badge>
                )}
                {s.reservaFeita ? (
                  <Badge variant="success">reserva feita</Badge>
                ) : (
                  <Badge variant="outline">reserva pendente</Badge>
                )}
              </div>
            </div>

            {s.semAliquota ? null : (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Passo
                  titulo="1. Provisionar no resultado"
                  texto="Reconhece a obrigação: despesa tributária contra impostos a pagar. Isto entra no DRE."
                  feito={s.jaLancada}
                  rotulo="Provisionar"
                  desabilitado={!podeLancar || pending}
                  aoClicar={() =>
                    start(async () => {
                      const r = await provisionarAction(competence, s.legalEntityId);
                      if (!r.ok) {
                        showUndoToast({ message: r.error });
                        return;
                      }
                      setLista((l) =>
                        l.map((x) =>
                          x.legalEntityId === s.legalEntityId
                            ? { ...x, jaProvisionado: true, jaLancada: true }
                            : x
                        )
                      );
                      showUndoToast({ message: `Provisionado ${formatBRL(r.valor)}.` });
                    })
                  }
                />
                <Passo
                  titulo="2. Guardar na reserva"
                  texto="Segrega o caixa. NÃO é despesa — o dinheiro continua sendo da empresa, só sai do disponível. O sistema não transfere: você transfere e anota aqui."
                  feito={s.reservaFeita}
                  rotulo="Já transferi"
                  desabilitado={!podeLancar || pending}
                  aoClicar={async () => {
                    const ok = await confirmAction({
                      title: "Você já fez a transferência?",
                      description:
                        "Isto apenas REGISTRA que a transferência foi feita. O sistema nunca move dinheiro entre contas sozinho.",
                      confirmLabel: "Já transferi",
                    });
                    if (!ok) return;
                    start(async () => {
                      const r = await marcarReservaFeitaAction(competence, s.legalEntityId);
                      if (!r.ok) {
                        showUndoToast({ message: r.error });
                        return;
                      }
                      setLista((l) =>
                        l.map((x) =>
                          x.legalEntityId === s.legalEntityId ? { ...x, reservaFeita: true } : x
                        )
                      );
                      showUndoToast({ message: "Reserva registrada." });
                    });
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Passo({
  titulo, texto, feito, rotulo, desabilitado, aoClicar,
}: {
  titulo: string;
  texto: string;
  feito: boolean;
  rotulo: string;
  desabilitado: boolean;
  aoClicar: () => void;
}) {
  return (
    <div className="rounded-card border border-border p-3">
      <p className="text-dense font-medium">{titulo}</p>
      <p className="mt-0.5 text-caption text-muted-foreground">{texto}</p>
      {feito ? null : (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={desabilitado}
          onClick={aoClicar}
        >
          {rotulo}
        </Button>
      )}
    </div>
  );
}
