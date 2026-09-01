"use client";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { History, MessageCircle, ScrollText, StickyNote } from "lucide-react";
import type { EventoDaLinha, Trilha } from "@/lib/services/client-timeline";

/**
 * LINHA DO TEMPO UNIFICADA (F1.16 · 02 §4.1 e gabarito 5).
 *
 * "Eventos cronológicos com ícone de trilha, agrupamento por dia, filtro por
 * trilha." As três trilhas continuam morando cada uma na sua tabela — esta
 * tela só INTERCALA.
 */

const TRILHA_META: Record<Trilha, { rotulo: string; Icone: typeof ScrollText }> = {
  AUDITORIA: { rotulo: "Auditoria", Icone: ScrollText },
  COBRANCA: { rotulo: "Cobrança", Icone: MessageCircle },
  CONTEXTO: { rotulo: "Contexto", Icone: StickyNote },
};

type EventoSerializado = Omit<EventoDaLinha, "quando"> & { quando: string };

export function TimelineTab({ eventos }: { eventos: EventoSerializado[] }) {
  const [filtro, setFiltro] = useState<Trilha | "TODAS">("TODAS");

  const grupos = useMemo(() => {
    const visiveis = eventos.filter((e) => filtro === "TODAS" || e.trilha === filtro);
    const porDia = new Map<string, EventoSerializado[]>();
    for (const e of visiveis) {
      const dia = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date(e.quando));
      const lista = porDia.get(dia) ?? [];
      lista.push(e);
      porDia.set(dia, lista);
    }
    return [...porDia.entries()];
  }, [eventos, filtro]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por trilha">
        <Button
          variant={filtro === "TODAS" ? "default" : "outline"}
          size="sm"
          onClick={() => setFiltro("TODAS")}
        >
          Todas
        </Button>
        {(Object.keys(TRILHA_META) as Trilha[]).map((t) => (
          <Button
            key={t}
            variant={filtro === t ? "default" : "outline"}
            size="sm"
            onClick={() => setFiltro(t)}
          >
            {TRILHA_META[t].rotulo}
          </Button>
        ))}
      </div>

      {grupos.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nada nesta trilha ainda"
          description="Alterações de cadastro, contatos de cobrança e notas aparecem aqui, intercalados por dia."
        />
      ) : (
        <div className="space-y-4">
          {grupos.map(([dia, lista]) => (
            <Card key={dia}>
              <CardContent className="p-4">
                <h3 className="mb-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
                  {dia}
                </h3>
                <ol className="space-y-2.5">
                  {lista.map((e) => {
                    const { rotulo, Icone } = TRILHA_META[e.trilha];
                    return (
                      <li key={e.id} className="flex gap-2.5">
                        <Icone
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="text-body">
                            <span className="font-medium">{e.titulo}</span>{" "}
                            <span className="text-caption text-muted-foreground">
                              · {rotulo} ·{" "}
                              {new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(new Date(e.quando))}
                              {e.autor ? ` · ${e.autor}` : ""}
                            </span>
                          </p>
                          {e.detalhe ? (
                            <p className="text-dense text-muted-foreground">{e.detalhe}</p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
