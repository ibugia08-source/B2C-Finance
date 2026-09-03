"use client";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { showUndoToast } from "@/components/undo-toast";
import { formatBRL } from "@/lib/format";
import { salvarAvaliacao, confirmarTodosSemMudanca } from "@/lib/actions/avaliacoes";
import {
  ADS_STATUS, ESTABILIDADE, RISCO, UPSELL, type LinhaAvaliacao,
} from "@/lib/avaliacao-meta";

/**
 * GRADE DE AVALIAÇÃO MENSAL (F1.17 · ref. 02 §4.1).
 *
 * "Custo alvo: 10 min/gestor/mês." Esse número é a especificação de
 * verdade, e três decisões saem dele:
 *
 *  1. a linha JÁ CHEGA respondida com o mês anterior — o trabalho é
 *     corrigir o que mudou, não preencher do zero;
 *  2. "Confirmar todos os sem mudança" resolve a maioria numa tecla;
 *  3. teclado célula a célula, porque tirar a mão do teclado sessenta
 *     vezes é o que transforma dez minutos em uma hora.
 *
 * Setas movem, Enter confirma a linha e desce. A confirmação é otimista
 * (02 §7.7): a linha assenta na hora e reverte com o motivo se o
 * servidor recusar.
 */

const COLUNAS = [
  { campo: "estabilidade" as const, titulo: "Estabilidade", opcoes: ESTABILIDADE },
  { campo: "ads" as const, titulo: "Ads", opcoes: ADS_STATUS },
  { campo: "risco" as const, titulo: "Risco", opcoes: RISCO },
  { campo: "upsell" as const, titulo: "Upsell", opcoes: UPSELL },
];

type Campo = (typeof COLUNAS)[number]["campo"] | "observacao";

export function GradeAvaliacao({
  competence,
  linhas: iniciais,
  podeEditar,
}: {
  competence: string;
  linhas: LinhaAvaliacao[];
  podeEditar: boolean;
}) {
  const [linhas, setLinhas] = useState(iniciais);
  const [pending, start] = useTransition();
  const gradeRef = useRef<HTMLTableSectionElement>(null);

  const pendentes = useMemo(() => linhas.filter((l) => !l.confirmada).length, [linhas]);

  const alterar = useCallback((id: string, campo: Campo, valor: string) => {
    setLinhas((prev) =>
      prev.map((l) =>
        l.relationshipId === id ? { ...l, [campo]: valor || null, herdada: false } : l
      )
    );
  }, []);

  const confirmar = useCallback(
    (linha: LinhaAvaliacao) => {
      setLinhas((prev) =>
        prev.map((l) => (l.relationshipId === linha.relationshipId ? { ...l, confirmada: true } : l))
      );
      start(async () => {
        const res = await salvarAvaliacao(competence, {
          relationshipId: linha.relationshipId,
          estabilidade: linha.estabilidade,
          ads: linha.ads,
          risco: linha.risco,
          upsell: linha.upsell,
          observacao: linha.observacao,
        });
        if (!res.ok) {
          setLinhas((prev) =>
            prev.map((l) =>
              l.relationshipId === linha.relationshipId ? { ...l, confirmada: false } : l
            )
          );
          showUndoToast({ message: res.error });
        }
      });
    },
    [competence]
  );

  function confirmarLote() {
    start(async () => {
      const res = await confirmarTodosSemMudanca(competence);
      if (res.ok) {
        setLinhas((prev) => prev.map((l) => ({ ...l, confirmada: true })));
        showUndoToast({ message: `${res.gravadas ?? 0} avaliação(ões) confirmada(s) sem mudança.` });
      } else {
        showUndoToast({ message: res.error });
      }
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTableSectionElement>) {
    const alvo = e.target as HTMLElement;
    const celula = alvo.closest("[data-celula]") as HTMLElement | null;
    if (!celula) return;
    const [linhaIdx, colIdx] = (celula.dataset.celula ?? "").split(":").map(Number);

    const mover = (dl: number, dc: number) => {
      e.preventDefault();
      gradeRef.current
        ?.querySelector<HTMLElement>(`[data-celula="${linhaIdx + dl}:${colIdx + dc}"] [data-foco]`)
        ?.focus();
    };

    if (e.key === "ArrowDown") mover(1, 0);
    else if (e.key === "ArrowUp") mover(-1, 0);
    // Esquerda/direita só navegam a partir de um select — dentro de um
    // campo de texto elas pertencem ao cursor, não à grade.
    else if (e.key === "ArrowRight" && alvo.tagName === "SELECT") mover(0, 1);
    else if (e.key === "ArrowLeft" && alvo.tagName === "SELECT") mover(0, -1);
    else if (e.key === "Enter") {
      e.preventDefault();
      const linha = linhas[linhaIdx];
      if (linha) confirmar(linha);
      gradeRef.current
        ?.querySelector<HTMLElement>(`[data-celula="${linhaIdx + 1}:0"] [data-foco]`)
        ?.focus();
    }
  }

  if (linhas.length === 0) {
    return (
      <EmptyState
        title="Nenhum cliente ativo para avaliar"
        description="A grade lista os clientes com relação ativa ou em implantação — ainda não há nenhum."
        passo="clientes"
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-body text-muted-foreground">
          {pendentes === 0 ? (
            <span className="text-success">Todas as {linhas.length} avaliações confirmadas.</span>
          ) : (
            <>
              <span className="font-medium text-foreground">{pendentes}</span> de {linhas.length} ainda
              sem confirmação neste mês.
            </>
          )}
        </p>
        {podeEditar && pendentes > 0 && (
          <Button onClick={confirmarLote} disabled={pending}>
            <Check className="mr-1 h-4 w-4" />
            Confirmar {pendentes} sem mudança
          </Button>
        )}
      </div>

      <p className="mb-2 flex items-center gap-1.5 text-caption text-muted-foreground">
        <Keyboard className="h-3.5 w-3.5" aria-hidden />
        Setas movem entre células · Enter confirma a linha e desce
      </p>

      <div className="overflow-x-auto rounded-card border">
        <table className="w-full text-dense">
          <thead className="bg-surface-sunken">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Cliente</th>
              {COLUNAS.map((c) => (
                <th key={c.campo} className="px-2 py-2 font-medium">{c.titulo}</th>
              ))}
              <th className="px-2 py-2 font-medium">Observação</th>
              <th className="px-3 py-2 text-right font-medium">Situação</th>
            </tr>
          </thead>
          <tbody ref={gradeRef} onKeyDown={onKeyDown}>
            {linhas.map((l, li) => (
              <tr
                key={l.relationshipId}
                className={cn(
                  "border-t",
                  l.confirmada ? "bg-success-soft/40" : l.herdada && "bg-warning-soft/25"
                )}
              >
                <td className="px-3 py-1.5">
                  <Link href={`/clientes/${l.clientId}`} className="font-medium hover:underline">
                    {l.clientName}
                  </Link>
                  {l.vencidas > 0 && (
                    <span className="ml-2 whitespace-nowrap text-caption text-destructive">
                      {l.vencidas} vencida(s) · {formatBRL(l.saldoVencido)}
                    </span>
                  )}
                  {l.gestores.length > 0 && (
                    <span className="block text-caption text-muted-foreground">
                      {l.gestores.join(" · ")}
                    </span>
                  )}
                </td>

                {COLUNAS.map((c, ci) => (
                  <td key={c.campo} className="px-2 py-1.5" data-celula={`${li}:${ci}`}>
                    <select
                      data-foco
                      disabled={!podeEditar}
                      aria-label={`${c.titulo} de ${l.clientName}`}
                      value={(l[c.campo] as string) ?? ""}
                      onChange={(e) => alterar(l.relationshipId, c.campo, e.target.value)}
                      className="h-8 w-full min-w-[8.5rem] rounded-cell border bg-background px-1.5 text-dense focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">—</option>
                      {c.opcoes.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    {c.campo === "risco" && l.riscoSugerido && l.risco !== l.riscoSugerido && (
                      <button
                        type="button"
                        onClick={() => alterar(l.relationshipId, "risco", l.riscoSugerido!)}
                        title={l.motivoSugestao ?? ""}
                        className="mt-0.5 block text-[10px] text-warning hover:underline"
                      >
                        sugerido: {l.riscoSugerido}
                      </button>
                    )}
                  </td>
                ))}

                <td className="px-2 py-1.5" data-celula={`${li}:${COLUNAS.length}`}>
                  <input
                    data-foco
                    disabled={!podeEditar}
                    aria-label={`Observação de ${l.clientName}`}
                    value={l.observacao ?? ""}
                    onChange={(e) => alterar(l.relationshipId, "observacao", e.target.value)}
                    className="h-8 w-full min-w-[12rem] rounded-cell border bg-background px-2 text-dense focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </td>

                <td className="px-3 py-1.5 text-right">
                  {l.confirmada ? (
                    <span className="inline-flex items-center gap-1 text-caption text-success">
                      <Check className="h-3.5 w-3.5" aria-hidden /> confirmada
                    </span>
                  ) : podeEditar ? (
                    <Button size="sm" variant="outline" onClick={() => confirmar(l)} disabled={pending}>
                      Confirmar
                    </Button>
                  ) : (
                    <span className="text-caption text-muted-foreground">pendente</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
