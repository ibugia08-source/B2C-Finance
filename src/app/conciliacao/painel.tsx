"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { askReason } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { formatBRL } from "@/lib/format";
import {
  conciliarAction, conciliarAutomaticamenteAction, ignorarLinhaAction,
  importarExtratoAction, reabrirLinhaAction,
  sugestoesAction,
} from "@/lib/actions/conciliacao";
import type {
  ResumoDaConciliacao, Sugestao, AlvoDeMatch,
} from "@/lib/services/reconciliation";

type Linha = {
  id: string;
  postedAt: Date | string;
  amount: number;
  description: string;
  state: string;
  note: string | null;
  conciliado: number;
  diferenca: number;
  matches: { id: string; targetType: AlvoDeMatch; targetId: string; amount: number }[];
};

const ROTULO_ESTADO: Record<string, { texto: string; variante: "success" | "warning" | "outline" | "secondary" }> = {
  MATCHED: { texto: "conciliada", variante: "success" },
  PARTIAL: { texto: "parcial", variante: "warning" },
  REVIEW: { texto: "em revisão", variante: "warning" },
  IGNORED: { texto: "ignorada", variante: "secondary" },
  UNMATCHED: { texto: "sem par", variante: "outline" },
};

const ROTULO_SITUACAO: Record<string, string> = {
  PARADA: "sem movimento",
  SEM_EXTRATO: "sem extrato",
  ABAIXO_DO_MINIMO: "abaixo do mínimo",
  OK: "no mínimo",
};

/**
 * A fila de trabalho da conciliação.
 *
 * As sugestões são carregadas SOB DEMANDA, ao abrir a linha. Carregar as oito
 * sugestões de cada uma das duzentas linhas do mês na abertura da tela faria
 * a conciliação ser a página mais lenta do sistema — e ela é usada com o
 * extrato do banco aberto ao lado, com pressa.
 */
export function PainelDeConciliacao({
  competence,
  resumo,
  contas,
  contaAtual,
  linhas,
  podeConciliar,
}: {
  competence: string;
  resumo: ResumoDaConciliacao;
  contas: { id: string; name: string }[];
  contaAtual: string | null;
  linhas: Linha[];
  podeConciliar: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function trocarConta(id: string) {
    const p = new URLSearchParams(sp.toString());
    p.set("conta", id);
    p.set("mes", competence);
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {resumo.contas.map((c) => (
          <button
            key={c.accountId}
            type="button"
            onClick={() => trocarConta(c.accountId)}
            className={`rounded-md border p-3 text-left transition-colors ${
              c.accountId === contaAtual ? "border-brand bg-surface-sunken" : "hover:bg-surface-sunken"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-body font-medium">{c.nome}</span>
              <Badge
                variant={
                  c.situacao === "OK" ? "success" : c.situacao === "PARADA" ? "outline" : "warning"
                }
              >
                {ROTULO_SITUACAO[c.situacao]}
              </Badge>
            </div>
            <p className="mt-1 text-caption text-muted-foreground">
              {c.situacao === "PARADA"
                ? "Nada movimentou no mês — só confirmar o saldo."
                : c.situacao === "SEM_EXTRATO"
                  ? `${c.movimentosNoSistema} lançamentos no sistema e nenhum extrato importado.`
                  : `${c.resolvidas} de ${c.linhas} linhas resolvidas (${c.percentual}%).`}
            </p>
          </button>
        ))}
      </div>

      {podeConciliar && contaAtual ? (
        <div className="mb-3">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await conciliarAutomaticamenteAction(contaAtual, competence);
                showUndoToast({
                  message:
                    r.conciliadas > 0
                      ? `${r.conciliadas} de ${r.examinadas} ${r.examinadas === 1 ? "linha resolvida" : "linhas resolvidas"} sozinhas — o resto ficou para você, com o motivo.`
                      : r.examinadas === 0
                        ? "Nenhuma linha pendente nesta conta."
                        : "Nenhuma linha tinha resposta óbvia — todas precisam de decisão humana.",
                });
                router.refresh();
              })
            }
          >
            Conciliar automaticamente
          </Button>
        </div>
      ) : null}

      {podeConciliar ? (
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          action={(fd) =>
            start(async () => {
              const r = await importarExtratoAction(fd);
              if (!r.ok) return showUndoToast({ message: r.error });
              showUndoToast({
                message:
                  `${r.importadas} ${r.importadas === 1 ? "linha nova" : "linhas novas"}` +
                  (r.duplicadas > 0 ? ` · ${r.duplicadas} já estavam no sistema` : "") +
                  (r.erros.length > 0 ? ` · ${r.erros.length} não foram lidas` : ""),
              });
              if (inputRef.current) inputRef.current.value = "";
              router.refresh();
            })
          }
        >
          {contas.length === 0 ? (
            <div className="space-y-1.5">
              <label htmlFor="conc-conta-nome" className="text-caption text-muted-foreground">
                Nome da conta (a primeira importação cria a conta)
              </label>
              <Input
                id="conc-conta-nome"
                name="accountName"
                placeholder="ex.: Itaú PJ"
                className="max-w-xs"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="conc-conta" className="text-caption text-muted-foreground">
                Conta
              </label>
              <Select id="conc-conta" name="accountId" defaultValue={contaAtual ?? ""}>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="conc-arquivo" className="text-caption text-muted-foreground">
              Extrato (.ofx ou .csv)
            </label>
            <input
              id="conc-arquivo"
              ref={inputRef}
              type="file"
              name="file"
              accept=".ofx,.csv,.txt,text/csv"
              className="block w-full max-w-xs rounded-md border bg-background p-1.5 text-dense text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-surface-sunken file:px-2.5 file:py-1 file:text-dense file:text-foreground"
            />
          </div>
          <Button type="submit" disabled={pending}>
            <Upload className="mr-1.5 h-4 w-4" aria-hidden />
            Importar
          </Button>
        </form>
      ) : null}

      {linhas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-dense text-muted-foreground">
            Nenhuma linha de extrato nesta conta neste mês. Importe o arquivo do
            banco para começar.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {linhas.map((l) => (
            <LinhaDoExtrato key={l.id} linha={l} podeConciliar={podeConciliar} />
          ))}
        </ul>
      )}
    </>
  );
}

function LinhaDoExtrato({ linha, podeConciliar }: { linha: Linha; podeConciliar: boolean }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [sugestoes, setSugestoes] = useState<Sugestao[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const visual = ROTULO_ESTADO[linha.state] ?? ROTULO_ESTADO.UNMATCHED;
  const escolhidas = (sugestoes ?? []).filter((s) => marcadas.has(`${s.targetType}:${s.targetId}`));
  const soma = Math.round(escolhidas.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const diferenca = Math.round((linha.amount - soma) * 100) / 100;

  function abrir() {
    setAberta((v) => !v);
    if (sugestoes === null) {
      start(async () => setSugestoes(await sugestoesAction(linha.id)));
    }
  }

  return (
    <li>
      <Card>
        <CardContent className="p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-body font-medium">{linha.description}</p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {new Intl.DateTimeFormat("pt-BR").format(new Date(linha.postedAt))}
                {linha.note ? ` · ${linha.note}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p
                className={`stat-number whitespace-nowrap font-semibold ${
                  linha.amount < 0 ? "text-destructive" : "text-success"
                }`}
              >
                {formatBRL(linha.amount)}
              </p>
              <Badge variant={visual.variante} className="mt-1">
                {visual.texto}
              </Badge>
            </div>
          </div>

          {linha.state === "PARTIAL" || linha.state === "REVIEW" ? (
            <p className="mt-2 text-dense text-warning">
              Diferença de {formatBRL(linha.diferenca)} — nada foi lançado por conta
              disso.
            </p>
          ) : null}

          {podeConciliar ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {linha.state === "IGNORED" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await reabrirLinhaAction(linha.id);
                      router.refresh();
                    })
                  }
                >
                  Voltar para a fila
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={abrir}>
                    {aberta ? "Fechar" : linha.matches.length > 0 ? "Rever conciliação" : "Conciliar"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={async () => {
                      const motivo = await askReason({
                        title: "Ignorar esta linha?",
                        description:
                          "Ela sai da fila e passa a contar como resolvida. O motivo fica registrado.",
                        motivo: { label: "Por que esta linha não é do sistema?", minimo: 5 },
                        confirmLabel: "Ignorar",
                      });
                      if (!motivo) return;
                      start(async () => {
                        const r = await ignorarLinhaAction(linha.id, motivo);
                        if (!r.ok) return showUndoToast({ message: r.error });
                        router.refresh();
                      });
                    }}
                  >
                    Ignorar
                  </Button>
                </>
              )}
            </div>
          ) : null}

          {aberta ? (
            <div className="mt-3 border-t border-border-soft pt-3">
              {sugestoes === null ? (
                <p className="text-dense text-muted-foreground">Procurando…</p>
              ) : sugestoes.length === 0 ? (
                <p className="text-dense text-muted-foreground">
                  Nenhum lançamento do sistema com este valor por perto. Se este
                  movimento existe mesmo, lance-o primeiro — a conciliação não
                  cria receita nem despesa.
                </p>
              ) : (
                <>
                  <ul className="space-y-1">
                    {sugestoes.map((s) => {
                      const chave = `${s.targetType}:${s.targetId}`;
                      return (
                        <li key={chave} className="flex items-center gap-2">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-dense">
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0"
                              checked={marcadas.has(chave)}
                              onChange={() =>
                                setMarcadas((m) => {
                                  const novo = new Set(m);
                                  if (novo.has(chave)) novo.delete(chave);
                                  else novo.add(chave);
                                  return novo;
                                })
                              }
                            />
                            <span className="min-w-0 truncate">{s.descricao}</span>
                          </label>
                          <span className="whitespace-nowrap text-caption text-muted-foreground">
                            {s.motivo}
                          </span>
                          <span className="whitespace-nowrap tabular-nums">
                            {formatBRL(s.amount)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  <p className="mt-2 text-dense">
                    Selecionado: {formatBRL(soma)} · diferença{" "}
                    <strong className={Math.abs(diferenca) > 0.005 ? "text-warning" : ""}>
                      {formatBRL(diferenca)}
                    </strong>
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={pending || escolhidas.length === 0}
                      onClick={() =>
                        start(async () => {
                          const r = await conciliarAction(
                            linha.id,
                            escolhidas.map((s) => ({
                              targetType: s.targetType,
                              targetId: s.targetId,
                              amount: s.amount,
                              confidence: s.confidence,
                            }))
                          );
                          if (!r.ok) return showUndoToast({ message: r.error });
                          showUndoToast({ message: "Conciliação registrada." });
                          router.refresh();
                        })
                      }
                    >
                      Conciliar
                    </Button>

                    {Math.abs(diferenca) > 0.005 && escolhidas.length > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={async () => {
                          const motivo = await askReason({
                            title: `Aceitar a diferença de ${formatBRL(diferenca)}?`,
                            description:
                              "A linha fica em revisão com a diferença escrita. Nenhum lançamento é criado — quem decide o ajuste é você, na tela de despesas ou de cobrança.",
                            motivo: { label: "O que é essa diferença?", minimo: 5 },
                            confirmLabel: "Aceitar e marcar para revisão",
                          });
                          if (!motivo) return;
                          start(async () => {
                            const r = await conciliarAction(
                              linha.id,
                              escolhidas.map((s) => ({
                                targetType: s.targetType,
                                targetId: s.targetId,
                                amount: s.amount,
                                confidence: s.confidence,
                              })),
                              motivo
                            );
                            if (!r.ok) return showUndoToast({ message: r.error });
                            router.refresh();
                          });
                        }}
                      >
                        Aceitar diferença
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}
