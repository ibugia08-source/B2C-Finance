"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { formatBRL, parseBRL } from "@/lib/format";
import { apagarMetaAction, definirMetaAction } from "@/lib/actions/metas";
import {
  ESCOPOS, METRICAS_DE_META, ROTULO_DO_ESCOPO,
  type EscopoDaMeta, type MetaCadastrada, type MetricaDeMeta,
} from "@/lib/commercial/metas";

/**
 * O formulário e a lista.
 *
 * A métrica é filtrada pelo ESCOPO: "ligações" só faz sentido para SDR,
 * "valor vendido" para closer, agência e gestor. Oferecer todas para todos
 * criaria metas que nenhum painel lê — e meta que ninguém vê é pior que meta
 * nenhuma, porque parece que existe controle.
 */
export function PainelDeMetas({
  competence,
  metas,
  agencias,
  pessoas,
  podeEditar,
}: {
  competence: string;
  metas: MetaCadastrada[];
  agencias: { id: string; name: string }[];
  pessoas: string[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [escopo, setEscopo] = useState<EscopoDaMeta>("SDR");
  const [quem, setQuem] = useState("");
  const [metrica, setMetrica] = useState<MetricaDeMeta>("ligacoes");
  const [alvo, setAlvo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const disponiveis = METRICAS_DE_META.filter((m) =>
    (m.escopos as readonly string[]).includes(escopo)
  );

  function trocarEscopo(e: EscopoDaMeta) {
    setEscopo(e);
    setQuem("");
    const primeira = METRICAS_DE_META.find((m) => (m.escopos as readonly string[]).includes(e));
    if (primeira) setMetrica(primeira.id);
  }

  return (
    <>
      {podeEditar ? (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="m-escopo">De quem é a meta</Label>
                <Select
                  id="m-escopo"
                  value={escopo}
                  onChange={(e) => trocarEscopo(e.target.value as EscopoDaMeta)}
                >
                  {ESCOPOS.map((e) => (
                    <option key={e} value={e}>{ROTULO_DO_ESCOPO[e]}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="m-quem">{escopo === "AGENCY" ? "Agência" : "Pessoa"}</Label>
                {escopo === "AGENCY" ? (
                  <Select id="m-quem" value={quem} onChange={(e) => setQuem(e.target.value)}>
                    <option value="">A casa inteira</option>
                    {agencias.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id="m-quem"
                    list="pessoas-conhecidas"
                    value={quem}
                    onChange={(e) => setQuem(e.target.value)}
                    placeholder="Nome"
                  />
                )}
                <datalist id="pessoas-conhecidas">
                  {pessoas.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="m-metrica">O que medir</Label>
                <Select
                  id="m-metrica"
                  value={metrica}
                  onChange={(e) => setMetrica(e.target.value as MetricaDeMeta)}
                >
                  {disponiveis.map((m) => (
                    <option key={m.id} value={m.id}>{m.rotulo}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="m-alvo">Meta do mês</Label>
                <div className="flex gap-2">
                  <Input
                    id="m-alvo"
                    inputMode="decimal"
                    value={alvo}
                    onChange={(e) => setAlvo(e.target.value)}
                  />
                  <Button
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setErro(null);
                        const r = await definirMetaAction({
                          competence,
                          scopeType: escopo,
                          scopeId: quem,
                          metric: metrica,
                          target: parseBRL(alvo) || 0,
                        });
                        if (!r.ok) return setErro(r.error);
                        setAlvo("");
                        showUndoToast({ message: "Meta definida." });
                        router.refresh();
                      })
                    }
                  >
                    Salvar
                  </Button>
                </div>
              </div>
            </div>
            {erro ? <p className="mt-2 text-dense text-destructive">{erro}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {metas.length === 0 ? (
            <p className="px-3.5 py-8 text-center text-dense text-muted-foreground">
              Nenhuma meta neste mês. Sem meta, os painéis mostram o número sem
              alvo — que é melhor do que um alvo que ninguém decidiu.
            </p>
          ) : (
            <ul className="divide-y divide-border-soft">
              {metas.map((m) => (
                <li key={m.id} className="flex items-center gap-2 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium">
                      {m.rotuloDaMetrica}
                      <span className="ml-1.5 text-caption font-normal text-muted-foreground">
                        {ROTULO_DO_ESCOPO[m.scopeType]}
                        {m.scopeId ? ` · ${agencias.find((a) => a.id === m.scopeId)?.name ?? m.scopeId}` : " · a casa inteira"}
                      </span>
                    </p>
                  </div>
                  <span className="whitespace-nowrap tabular-nums font-medium">
                    {m.unidade === "dinheiro" ? formatBRL(m.target) : m.target}
                  </span>
                  {podeEditar ? (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={`Apagar meta de ${m.rotuloDaMetrica}`}
                      disabled={pending}
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: "Apagar esta meta?",
                          description: "Os painéis voltam a mostrar o número sem alvo.",
                          destructive: true,
                          confirmLabel: "Apagar",
                        });
                        if (!ok) return;
                        start(async () => {
                          await apagarMetaAction(m.id);
                          router.refresh();
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
