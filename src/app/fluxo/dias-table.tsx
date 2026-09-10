"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  MobileCard, MobileCardHeader, MobileCards, MobileEmpty, Field,
} from "@/components/ui/record-card";
import { formatBRL } from "@/lib/format";
import type { DiaDoFluxo, TipoDeLancamento } from "@/lib/services/cash-flow";

/**
 * A TABELA DIA A DIA — o gabarito Planilha viva (02 §7.5).
 *
 * Cada linha é um dia; a linha ABRE e mostra os lançamentos daquele dia, com
 * link para onde se resolve cada um. Abrir em vez de navegar é o que permite
 * responder "por que o dia 22 fica negativo?" sem perder o lugar na lista.
 *
 * DIA SEM MOVIMENTO continua na tabela, em cinza: uma tabela que só mostra
 * os dias com lançamento faz o leitor contar dias no calendário para saber
 * quanto tempo falta — e é justamente o intervalo entre um pagamento e o
 * seguinte que diz se dá para esperar.
 *
 * O dia em que o saldo cruza o zero é pintado com a cor semântica de erro, a
 * mesma da linha vencida em toda a lista do produto.
 */
const ROTULO: Record<TipoDeLancamento, string> = {
  COBRANCA: "Cobrança",
  DESPESA: "Despesa",
  FATURA: "Fatura de cartão",
  FOLHA: "Folha",
};

export function DiasDoFluxo({
  dias,
  saldoInicial,
}: {
  dias: DiaDoFluxo[];
  saldoInicial: number;
}) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  function alternar(dia: string) {
    setAbertos((s) => {
      const novo = new Set(s);
      if (novo.has(dia)) novo.delete(dia);
      else novo.add(dia);
      return novo;
    });
  }

  const comMovimento = dias.filter((d) => d.lancamentos.length > 0);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-dense">
              <thead>
                <tr className="border-b border-border-soft text-left text-caption uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-3.5 py-2 font-medium">Dia</th>
                  <th className="px-3.5 py-2 text-right font-medium">Entradas</th>
                  <th className="px-3.5 py-2 text-right font-medium">Saídas</th>
                  <th className="px-3.5 py-2 text-right font-medium">Saldo acumulado</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border-soft bg-surface-sunken">
                  <td className="px-2 py-2"></td>
                  <td className="px-3.5 py-2 font-medium">Saldo de partida</td>
                  <td className="px-3.5 py-2"></td>
                  <td className="px-3.5 py-2"></td>
                  <td className="px-3.5 py-2 text-right font-medium tabular-nums">
                    {formatBRL(saldoInicial)}
                  </td>
                </tr>
                {dias.map((d) => {
                  const temMovimento = d.lancamentos.length > 0;
                  const aberto = abertos.has(d.dia);
                  return (
                    <Fragment key={d.dia}>
                      <tr
                        className={`border-b border-border-soft ${
                          d.saldoAcumulado < 0 ? "bg-destructive/5" : ""
                        } ${temMovimento ? "" : "text-muted-foreground"}`}
                      >
                        <td className="px-2 py-1.5">
                          {temMovimento ? (
                            <button
                              type="button"
                              onClick={() => alternar(d.dia)}
                              aria-expanded={aberto}
                              aria-label={`${aberto ? "Fechar" : "Abrir"} os lançamentos de ${rotulo(d.dia)}`}
                              className="rounded p-0.5 hover:bg-surface-sunken"
                            >
                              {aberto ? (
                                <ChevronDown className="h-4 w-4" aria-hidden />
                              ) : (
                                <ChevronRight className="h-4 w-4" aria-hidden />
                              )}
                            </button>
                          ) : null}
                        </td>
                        <td className="px-3.5 py-1.5">
                          {rotulo(d.dia)}
                          {temMovimento ? (
                            <span className="ml-1.5 text-caption text-muted-foreground">
                              {d.lancamentos.length}{" "}
                              {d.lancamentos.length === 1 ? "lançamento" : "lançamentos"}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3.5 py-1.5 text-right tabular-nums text-success">
                          {d.entradas > 0 ? `+ ${formatBRL(d.entradas)}` : "—"}
                        </td>
                        <td className="px-3.5 py-1.5 text-right tabular-nums text-destructive">
                          {d.saidas > 0 ? `− ${formatBRL(d.saidas)}` : "—"}
                        </td>
                        <td
                          className={`px-3.5 py-1.5 text-right font-medium tabular-nums ${
                            d.saldoAcumulado < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {formatBRL(d.saldoAcumulado)}
                        </td>
                      </tr>
                      {aberto
                        ? d.lancamentos.map((l) => (
                            <tr key={`${d.dia}-${l.tipo}-${l.id}`} className="border-b border-border-soft bg-surface-sunken/60">
                              <td></td>
                              <td className="px-3.5 py-1.5" colSpan={2}>
                                <span className="text-caption uppercase tracking-wide text-muted-foreground">
                                  {ROTULO[l.tipo]}
                                </span>{" "}
                                {l.href ? (
                                  <Link href={l.href} className="hover:underline">
                                    {l.descricao}
                                  </Link>
                                ) : (
                                  l.descricao
                                )}
                                {l.atrasada ? (
                                  <Badge variant="destructive" className="ml-2">vencida</Badge>
                                ) : null}
                                {l.estimada ? (
                                  <Badge variant="outline" className="ml-2">data estimada</Badge>
                                ) : null}
                              </td>
                              <td
                                className={`px-3.5 py-1.5 text-right tabular-nums ${
                                  l.valor > 0 ? "text-success" : "text-destructive"
                                }`}
                                colSpan={2}
                              >
                                {l.valor > 0 ? "+ " : "− "}
                                {formatBRL(Math.abs(l.valor))}
                              </td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* No celular, só os dias COM movimento viram cartão: rolar trinta
            cartões vazios para achar dois com conteúdo é pior que a tabela. */}
        <MobileCards>
          {comMovimento.length === 0 ? (
            <MobileEmpty>Nenhum lançamento previsto neste período.</MobileEmpty>
          ) : (
            comMovimento.map((d) => (
              <MobileCard key={d.dia}>
                <MobileCardHeader
                  title={rotulo(d.dia)}
                  aside={
                    <span
                      className={`font-semibold tabular-nums ${
                        d.saldoAcumulado < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {formatBRL(d.saldoAcumulado)}
                    </span>
                  }
                />
                <div className="space-y-1.5">
                  {d.entradas > 0 ? (
                    <Field label="Entradas">+ {formatBRL(d.entradas)}</Field>
                  ) : null}
                  {d.saidas > 0 ? (
                    <Field label="Saídas">− {formatBRL(d.saidas)}</Field>
                  ) : null}
                  {d.lancamentos.map((l) => (
                    <Field key={`${l.tipo}-${l.id}`} label={ROTULO[l.tipo]}>
                      {l.descricao} · {l.valor > 0 ? "+" : "−"} {formatBRL(Math.abs(l.valor))}
                    </Field>
                  ))}
                </div>
              </MobileCard>
            ))
          )}
        </MobileCards>
      </CardContent>
    </Card>
  );
}

/** "2026-09-22" → "22/09 (ter)" — dia da semana ajuda a ler o fim de semana. */
function rotulo(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  const semana = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short", timeZone: "UTC",
  }).format(d).replace(".", "");
  const [ano, mes, diaDoMes] = dia.split("-");
  void ano;
  return `${diaDoMes}/${mes} (${semana})`;
}
