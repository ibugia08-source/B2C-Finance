"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Copy, MessageCircle, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { askReason, confirmAction } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { formatBRL } from "@/lib/format";
import {
  enviarPeloSistemaAction, gerarLinkDePagamentoAction, marcarEnviadaAction,
  registrarPromessaAction, silenciarCobrancaAction,
} from "@/lib/actions/fila";
import { ignorarLinhaAction } from "@/lib/actions/conciliacao";
import { encerrarPendenciaAction } from "@/lib/actions/import-review";
import type { FilaDeCobranca } from "@/lib/services/collection-tasks";
import type { ItemRevisao } from "@/lib/services/import-review";

export type Trilha = "cobranca" | "conciliacao" | "importacao";

type LinhaConciliacao = {
  id: string;
  conta: string;
  descricao: string;
  valor: number;
  data: Date | string;
  estado: string;
};

const NOME_DA_TRILHA: Record<Trilha, string> = {
  cobranca: "Cobrança",
  conciliacao: "Conciliação",
  importacao: "Revisão de importação",
};

/**
 * O MODO FILA (02 §7.5 gabarito 3).
 *
 * Três decisões de projeto que valem mais que o código:
 *
 *  1. O item em foco NÃO SAI DA LISTA quando é resolvido — ele fica marcado e
 *     o foco avança. Item que some faz a pessoa perder a referência do que
 *     acabou de fazer, e "pulei ou resolvi?" é a dúvida que trava a fila.
 *  2. PULAR NÃO PEDE NADA (02 §7.5: "pular sem culpa"). Fila que exige
 *     justificativa para adiar é fila que a pessoa fecha.
 *  3. O contador é "12 de 38" e conta o TRABALHO, não o restante — é o número
 *     que diz se vale a pena terminar agora.
 */
export function ModoFila({
  trilhaInicial,
  cobranca,
  conciliacao,
  revisao,
  podeCobrar,
  envioIntegrado,
  gatewayAtivo,
  podeConciliar,
  podeRevisar,
}: {
  trilhaInicial: Trilha;
  cobranca: FilaDeCobranca;
  conciliacao: LinhaConciliacao[];
  revisao: ItemRevisao[];
  podeCobrar: boolean;
  /** F5.1: o provedor de WhatsApp está ligado — o Enter passa a enviar de verdade. */
  envioIntegrado: boolean;
  /** F5.2: o gateway de pagamento está ligado — dá para emitir link daqui. */
  gatewayAtivo: boolean;
  podeConciliar: boolean;
  podeRevisar: boolean;
}) {
  const [trilha, setTrilha] = useState<Trilha>(trilhaInicial);
  const [indice, setIndice] = useState(0);
  const [resolvidos, setResolvidos] = useState<Set<string>>(new Set());
  const [ajuda, setAjuda] = useState(false);
  const [pending, start] = useTransition();

  const tamanhos: Record<Trilha, number> = {
    cobranca: cobranca.tarefas.length,
    conciliacao: conciliacao.length,
    importacao: revisao.length,
  };
  const total = tamanhos[trilha];

  const irPara = useCallback(
    (delta: number) => {
      setIndice((i) => Math.max(0, Math.min(total - 1, i + delta)));
    },
    [total]
  );

  function trocarTrilha(t: Trilha) {
    setTrilha(t);
    setIndice(0);
  }

  const marcarResolvido = useCallback(
    (id: string) => {
      setResolvidos((s) => new Set(s).add(id));
      setIndice((i) => Math.min(total - 1, i + 1));
    },
    [total]
  );

  const tarefa = trilha === "cobranca" ? cobranca.tarefas[indice] : null;
  const linha = trilha === "conciliacao" ? conciliacao[indice] : null;
  const item = trilha === "importacao" ? revisao[indice] : null;
  const idAtual = tarefa?.billingId ?? linha?.id ?? item?.id ?? null;

  // --- ações ---------------------------------------------------------------

  const enviar = useCallback(() => {
    if (!tarefa || !podeCobrar) return;
    start(async () => {
      // Com o provedor ligado (F5.1 · 19.17), o clique humano É o disparo:
      // o sistema registra a etapa e entrega a mensagem — nada é agendado.
      if (envioIntegrado) {
        const r = await enviarPeloSistemaAction(tarefa.billingId, tarefa.etapa, tarefa.mensagem);
        if (!r.ok) return showUndoToast({ message: r.error });
        showUndoToast({ message: `Mensagem de ${tarefa.etapa} enviada para ${tarefa.cliente}.` });
        marcarResolvido(tarefa.billingId);
        return;
      }
      await navigator.clipboard?.writeText(tarefa.mensagem).catch(() => {});
      const r = await marcarEnviadaAction(tarefa.billingId, tarefa.etapa, tarefa.mensagem);
      if (!r.ok) return showUndoToast({ message: r.error });
      showUndoToast({ message: `Mensagem copiada e ${tarefa.etapa} registrada.` });
      marcarResolvido(tarefa.billingId);
    });
  }, [tarefa, podeCobrar, envioIntegrado, marcarResolvido]);

  const prometer = useCallback(() => {
    if (!tarefa || !podeCobrar) return;
    const sugerida = new Date();
    sugerida.setDate(sugerida.getDate() + 3);
    (async () => {
      const texto = await askReason({
        title: `Promessa de ${tarefa.cliente}`,
        description:
          "Enquanto a data não chegar, a régua não gera tarefa para esta cobrança.",
        motivo: {
          label: "Para quando o cliente prometeu? (dd/mm/aaaa)",
          placeholder: new Intl.DateTimeFormat("pt-BR").format(sugerida),
          minimo: 8,
        },
        confirmLabel: "Registrar promessa",
      });
      if (!texto) return;
      const m = texto.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (!m) return showUndoToast({ message: "Data inválida — use dd/mm/aaaa." });
      const data = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      start(async () => {
        const r = await registrarPromessaAction(tarefa.billingId, data.toISOString());
        if (!r.ok) return showUndoToast({ message: r.error });
        showUndoToast({ message: "Promessa registrada." });
        marcarResolvido(tarefa.billingId);
      });
    })();
  }, [tarefa, podeCobrar, marcarResolvido]);

  const silenciar = useCallback(() => {
    if (!tarefa || !podeCobrar) return;
    (async () => {
      const motivo = await askReason({
        title: `Bloquear a cobrança de ${tarefa.cliente}?`,
        description:
          "A régua para de gerar tarefas para este cliente até alguém desbloquear. A dívida continua existindo.",
        motivo: { label: "Por quê?", minimo: 5 },
        confirmLabel: "Bloquear",
        destructive: true,
      });
      if (!motivo) return;
      start(async () => {
        const r = await silenciarCobrancaAction(tarefa.clientId, null, motivo);
        if (!r.ok) return showUndoToast({ message: r.error });
        showUndoToast({ message: "Cobrança bloqueada." });
        marcarResolvido(tarefa.billingId);
      });
    })();
  }, [tarefa, podeCobrar, marcarResolvido]);

  const ignorarConciliacao = useCallback(() => {
    if (!linha || !podeConciliar) return;
    (async () => {
      const motivo = await askReason({
        title: "Ignorar esta linha do extrato?",
        description: "Ela sai da fila e passa a contar como resolvida.",
        motivo: { label: "Por que esta linha não é do sistema?", minimo: 5 },
        confirmLabel: "Ignorar",
      });
      if (!motivo) return;
      start(async () => {
        const r = await ignorarLinhaAction(linha.id, motivo);
        if (!r.ok) return showUndoToast({ message: r.error });
        marcarResolvido(linha.id);
      });
    })();
  }, [linha, podeConciliar, marcarResolvido]);

  const resolverImport = useCallback(
    (como: "RESOLVIDO" | "DESCARTADO") => {
      if (!item || !podeRevisar) return;
      start(async () => {
        await encerrarPendenciaAction(item.id, como);
        showUndoToast({
          message: como === "RESOLVIDO" ? "Linha marcada como conferida." : "Linha descartada.",
        });
        marcarResolvido(item.id);
      });
    },
    [item, podeRevisar, marcarResolvido]
  );

  // --- teclado -------------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      // Nunca sequestrar teclas de quem está digitando.
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable))
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); irPara(1); break;
        case "k": case "ArrowUp": e.preventDefault(); irPara(-1); break;
        case "s": case "ArrowRight": e.preventDefault(); irPara(1); break;
        case "Enter":
          e.preventDefault();
          if (trilha === "cobranca") enviar();
          else if (trilha === "conciliacao") ignorarConciliacao();
          else resolverImport("RESOLVIDO");
          break;
        case "p": if (trilha === "cobranca") { e.preventDefault(); prometer(); } break;
        case "b": if (trilha === "cobranca") { e.preventDefault(); silenciar(); } break;
        case "x": if (trilha === "importacao") { e.preventDefault(); resolverImport("DESCARTADO"); } break;
        case "1": e.preventDefault(); trocarTrilha("cobranca"); break;
        case "2": e.preventDefault(); trocarTrilha("conciliacao"); break;
        case "3": e.preventDefault(); trocarTrilha("importacao"); break;
        case "?": e.preventDefault(); setAjuda((v) => !v); break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trilha, irPara, enviar, prometer, silenciar, ignorarConciliacao, resolverImport]);

  const feitos = resolvidos.size;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(Object.keys(NOME_DA_TRILHA) as Trilha[]).map((t, i) => (
          <Button
            key={t}
            variant={t === trilha ? "default" : "outline"}
            size="sm"
            onClick={() => trocarTrilha(t)}
          >
            <span className="mr-1.5 text-caption opacity-70">{i + 1}</span>
            {NOME_DA_TRILHA[t]}
            <span className="ml-1.5 tabular-nums opacity-70">{tamanhos[t]}</span>
          </Button>
        ))}
        <span className="ml-auto text-dense tabular-nums text-muted-foreground">
          {total === 0 ? "nada aqui" : `${Math.min(indice + 1, total)} de ${total}`}
          {feitos > 0 ? ` · ${feitos} ${feitos === 1 ? "resolvido" : "resolvidos"}` : ""}
        </span>
      </div>

      {ajuda ? (
        <Card className="mb-3">
          <CardContent className="p-3.5 text-dense">
            <ul className="grid gap-1 sm:grid-cols-2">
              <li><Tecla>j</Tecla> / <Tecla>↓</Tecla> próximo · <Tecla>k</Tecla> / <Tecla>↑</Tecla> anterior</li>
              <li><Tecla>s</Tecla> pular sem resolver</li>
              <li><Tecla>Enter</Tecla> ação principal da trilha</li>
              <li><Tecla>p</Tecla> registrar promessa (cobrança)</li>
              <li><Tecla>b</Tecla> bloquear a cobrança do cliente</li>
              <li><Tecla>x</Tecla> descartar (revisão de importação)</li>
              <li><Tecla>1</Tecla> <Tecla>2</Tecla> <Tecla>3</Tecla> trocar de trilha</li>
              <li><Tecla>?</Tecla> abrir e fechar esta ajuda</li>
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {total === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-dense text-muted-foreground">
            Nada nesta trilha agora.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardContent className="p-4">
              {tarefa ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-emphasis font-semibold">{tarefa.cliente}</p>
                      <p className="mt-0.5 text-dense text-muted-foreground">
                        {tarefa.descricao} · vence em{" "}
                        {new Intl.DateTimeFormat("pt-BR").format(new Date(tarefa.dueDate))}
                        {tarefa.diasDeAtraso > 0
                          ? ` · ${tarefa.diasDeAtraso} ${tarefa.diasDeAtraso === 1 ? "dia" : "dias"} de atraso`
                          : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="stat-number whitespace-nowrap text-value font-semibold">
                        {formatBRL(tarefa.valorEmAberto)}
                      </p>
                      <Badge variant="outline" className="mt-1">{tarefa.etapa}</Badge>
                    </div>
                  </div>

                  <p className="mt-2 text-dense text-muted-foreground">{tarefa.objetivo}</p>

                  <pre className="mt-3 whitespace-pre-wrap rounded-md bg-surface-sunken p-3 text-dense">
                    {tarefa.mensagem}
                  </pre>

                  {podeCobrar ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button disabled={pending} onClick={enviar}>
                        {envioIntegrado ? (
                          <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
                        ) : (
                          <Copy className="mr-1.5 h-4 w-4" aria-hidden />
                        )}
                        {envioIntegrado ? "Enviar agora" : "Copiar e marcar enviada"}{" "}
                        <Tecla className="ml-1.5">Enter</Tecla>
                      </Button>
                      {tarefa.whatsapp ? (
                        <Button variant="outline" asChild>
                          <a href={tarefa.whatsapp} target="_blank" rel="noreferrer">
                            <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
                            WhatsApp
                          </a>
                        </Button>
                      ) : null}
                      {gatewayAtivo && !tarefa.linkPagamento ? (
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const r = await gerarLinkDePagamentoAction(tarefa.billingId);
                              showUndoToast({
                                message: r.ok
                                  ? "Link de pagamento pedido — ele entra na mensagem assim que ficar pronto."
                                  : r.error,
                              });
                            })
                          }
                        >
                          Gerar link de pagamento
                        </Button>
                      ) : null}
                      <Button variant="outline" disabled={pending} onClick={prometer}>
                        Promessa <Tecla className="ml-1.5">p</Tecla>
                      </Button>
                      <Button variant="outline" disabled={pending} onClick={() => irPara(1)}>
                        <SkipForward className="mr-1.5 h-4 w-4" aria-hidden />
                        Pular <Tecla className="ml-1.5">s</Tecla>
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : linha ? (
                <>
                  <p className="truncate text-emphasis font-semibold">{linha.descricao}</p>
                  <p className="mt-0.5 text-dense text-muted-foreground">
                    {linha.conta} ·{" "}
                    {new Intl.DateTimeFormat("pt-BR").format(new Date(linha.data))}
                  </p>
                  <p
                    className={`stat-number mt-2 text-value font-semibold ${
                      linha.valor < 0 ? "text-destructive" : "text-success"
                    }`}
                  >
                    {formatBRL(linha.valor)}
                  </p>
                  <p className="mt-2 text-dense text-muted-foreground">
                    Sem par no sistema. Concilie na tela de conciliação, ou ignore
                    aqui se esta linha não é do sistema.
                  </p>
                  {podeConciliar ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button disabled={pending} onClick={ignorarConciliacao}>
                        Ignorar com motivo <Tecla className="ml-1.5">Enter</Tecla>
                      </Button>
                      <Button variant="outline" asChild>
                        <a href="/conciliacao">Abrir conciliação</a>
                      </Button>
                      <Button variant="outline" onClick={() => irPara(1)}>
                        Pular <Tecla className="ml-1.5">s</Tecla>
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : item ? (
                <>
                  <p className="truncate text-emphasis font-semibold">{item.rotulo}</p>
                  <p className="mt-0.5 text-dense text-muted-foreground">
                    {item.entity} · linha {item.sourceRow}
                    {item.arquivo ? ` · ${item.arquivo}` : ""}
                  </p>
                  <p className="mt-2 text-dense text-warning">
                    {item.motivo ?? "Marcada para conferência na importação."}
                  </p>
                  {podeRevisar ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button disabled={pending} onClick={() => resolverImport("RESOLVIDO")}>
                        Conferida <Tecla className="ml-1.5">Enter</Tecla>
                      </Button>
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={async () => {
                          const ok = await confirmAction({
                            title: "Descartar esta linha?",
                            description: "Ela sai da fila de revisão e fica registrada como descartada.",
                            destructive: true,
                            confirmLabel: "Descartar",
                          });
                          if (ok) resolverImport("DESCARTADO");
                        }}
                      >
                        Descartar <Tecla className="ml-1.5">x</Tecla>
                      </Button>
                      <Button variant="outline" onClick={() => irPara(1)}>
                        Pular <Tecla className="ml-1.5">s</Tecla>
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-3">
            <Card>
              <CardContent className="p-3.5">
                <p className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  A seguir
                </p>
                <ul className="space-y-1">
                  {(trilha === "cobranca"
                    ? cobranca.tarefas.map((t) => ({ id: t.billingId, texto: t.cliente, valor: t.valorEmAberto }))
                    : trilha === "conciliacao"
                      ? conciliacao.map((l) => ({ id: l.id, texto: l.descricao, valor: l.valor }))
                      : revisao.map((r) => ({ id: r.id, texto: r.rotulo, valor: null as number | null })))
                    .slice(Math.max(0, indice - 1), Math.max(0, indice - 1) + 8)
                    .map((x) => (
                      <li
                        key={x.id}
                        className={`flex justify-between gap-2 rounded px-1.5 py-1 text-dense ${
                          x.id === idAtual ? "bg-surface-sunken font-medium" : ""
                        } ${resolvidos.has(x.id) ? "text-muted-foreground line-through" : ""}`}
                      >
                        <span className="min-w-0 truncate">{x.texto}</span>
                        {x.valor !== null ? (
                          <span className="whitespace-nowrap tabular-nums">{formatBRL(x.valor)}</span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </CardContent>
            </Card>

            {trilha === "cobranca" && cobranca.suprimidas.length > 0 ? (
              <Card>
                <CardContent className="p-3.5">
                  <p className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Fora da fila hoje
                  </p>
                  <ul className="space-y-1.5">
                    {cobranca.suprimidas.slice(0, 8).map((s) => (
                      <li key={s.billingId} className="text-dense">
                        <span className="font-medium">{s.cliente}</span> —{" "}
                        <span className="text-muted-foreground">{s.explicacao}</span>
                        {s.ate ? (
                          <span className="text-muted-foreground">
                            {" "}
                            até {new Intl.DateTimeFormat("pt-BR").format(new Date(s.ate))}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-caption text-muted-foreground">
                    Aparecem aqui de propósito: cliente que some da fila em
                    silêncio é dívida que envelhece sem ninguém perceber.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Tecla({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-soft bg-surface-sunken px-1 text-[11px] font-medium ${className}`}
    >
      {children}
    </kbd>
  );
}
