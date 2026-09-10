"use client";
import { useMemo, useState, useTransition } from "react";
import { Copy, MessageCircle, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  MobileCard, MobileCardActions, MobileCardHeader, MobileCards, MobileEmpty, Field,
} from "@/components/ui/record-card";
import { askReason } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { formatBRL } from "@/lib/format";
import {
  despacharEmMassaAction, enviarPeloSistemaAction, gerarLinkDePagamentoAction,
  marcarEnviadaAction, registrarPromessaAction, silenciarCobrancaAction,
} from "@/lib/actions/regua-cobranca";
import type { CobrancaSuprimida, TarefaDeCobranca } from "@/lib/services/collection-tasks";

/**
 * A RÉGUA DO DIA COMO LISTA (F3.9 · 02 §4.3).
 *
 * Substitui o Modo Fila (gabarito 3), removido em 10/09/2026. A régua
 * PRIORIZADA continua idêntica — score, cinco degraus, sete tons, silêncios e
 * as suprimidas à vista com o motivo. O que mudou é o gesto: em vez de um
 * item em foco e uma tecla por decisão, uma TABELA com ação por linha e ação
 * em massa, que é o padrão de todas as outras telas de trabalho.
 *
 * Por que a lista ganhou do gabarito: a fila obrigava a percorrer os itens na
 * ordem dela para chegar em UM cliente, e ninguém aprendeu o teclado dela —
 * o mesmo trabalho é feito marcando as linhas e despachando de uma vez.
 *
 * AS SUPRIMIDAS CONTINUAM APARECENDO, com o motivo: cliente que some da
 * cobrança em silêncio é dívida que envelhece sem ninguém perceber.
 */
export function ReguaDoDia({
  tarefas,
  suprimidas,
  podeCobrar,
  envioIntegrado,
  gatewayAtivo,
}: {
  tarefas: TarefaDeCobranca[];
  suprimidas: CobrancaSuprimida[];
  podeCobrar: boolean;
  /** F5.1: provedor de WhatsApp ligado — o botão passa a enviar de verdade. */
  envioIntegrado: boolean;
  /** F5.2: gateway ligado — dá para pedir link de pagamento daqui. */
  gatewayAtivo: boolean;
}) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [feitas, setFeitas] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const selecionadas = useMemo(
    () => tarefas.filter((t) => marcadas.has(t.billingId)),
    [tarefas, marcadas]
  );
  const total = tarefas.reduce((s, t) => s + t.valorEmAberto, 0);

  function alternar(id: string) {
    setMarcadas((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function alternarTodas() {
    setMarcadas((s) =>
      s.size === tarefas.length ? new Set() : new Set(tarefas.map((t) => t.billingId))
    );
  }

  /** O item resolvido FICA na lista, marcado — some da tela é o que gera o "já cobrei este?". */
  function concluir(id: string) {
    setFeitas((s) => new Set(s).add(id));
    setMarcadas((s) => {
      const novo = new Set(s);
      novo.delete(id);
      return novo;
    });
  }

  function despachar(t: TarefaDeCobranca) {
    if (!podeCobrar) return;
    start(async () => {
      if (envioIntegrado) {
        const r = await enviarPeloSistemaAction(t.billingId, t.etapa, t.mensagem);
        if (!r.ok) return showUndoToast({ message: r.error });
        showUndoToast({ message: `Mensagem de ${t.etapa} enviada para ${t.cliente}.` });
        return concluir(t.billingId);
      }
      await navigator.clipboard?.writeText(t.mensagem).catch(() => {});
      const r = await marcarEnviadaAction(t.billingId, t.etapa, t.mensagem);
      if (!r.ok) return showUndoToast({ message: r.error });
      showUndoToast({ message: `Mensagem copiada e ${t.etapa} registrada.` });
      concluir(t.billingId);
    });
  }

  function despacharSelecionadas() {
    if (!podeCobrar || selecionadas.length === 0) return;
    start(async () => {
      if (!envioIntegrado) {
        // Sem provedor, o "envio" é a pessoa colando as mensagens — então o
        // massa entrega o TEXTO das selecionadas junto com o registro.
        await navigator.clipboard
          ?.writeText(selecionadas.map((t) => t.mensagem).join("\n\n———\n\n"))
          .catch(() => {});
      }
      const r = await despacharEmMassaAction(
        selecionadas.map((t) => ({
          billingId: t.billingId, etapa: t.etapa, mensagem: t.mensagem,
        })),
        envioIntegrado ? "enviar" : "marcar"
      );
      const recusadas = r.recusas.length;
      showUndoToast({
        message:
          `${r.enviadas} ${r.enviadas === 1 ? "cobrança registrada" : "cobranças registradas"}` +
          (envioIntegrado ? " e enviada(s)." : " — mensagens copiadas.") +
          (recusadas > 0 ? ` ${recusadas} recusada(s): ${r.recusas[0].erro}` : ""),
      });
      setFeitas((s) => {
        const novo = new Set(s);
        const recusados = new Set(r.recusas.map((x) => x.billingId));
        for (const t of selecionadas) if (!recusados.has(t.billingId)) novo.add(t.billingId);
        return novo;
      });
      setMarcadas(new Set());
    });
  }

  function prometer(t: TarefaDeCobranca) {
    const sugerida = new Date();
    sugerida.setDate(sugerida.getDate() + 3);
    (async () => {
      const texto = await askReason({
        title: `Promessa de ${t.cliente}`,
        description: "Enquanto a data não chegar, a régua não gera tarefa para esta cobrança.",
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
        const r = await registrarPromessaAction(t.billingId, data.toISOString());
        if (!r.ok) return showUndoToast({ message: r.error });
        showUndoToast({ message: "Promessa registrada." });
        concluir(t.billingId);
      });
    })();
  }

  function bloquear(t: TarefaDeCobranca) {
    (async () => {
      const motivo = await askReason({
        title: `Bloquear a cobrança de ${t.cliente}?`,
        description:
          "A régua para de gerar tarefas para este cliente até alguém desbloquear. A dívida continua existindo.",
        motivo: { label: "Por quê?", minimo: 5 },
        confirmLabel: "Bloquear",
        destructive: true,
      });
      if (!motivo) return;
      start(async () => {
        const r = await silenciarCobrancaAction(t.clientId, null, motivo);
        if (!r.ok) return showUndoToast({ message: r.error });
        showUndoToast({ message: "Cobrança bloqueada." });
        concluir(t.billingId);
      });
    })();
  }

  function pedirLink(t: TarefaDeCobranca) {
    start(async () => {
      const r = await gerarLinkDePagamentoAction(t.billingId);
      showUndoToast({
        message: r.ok
          ? "Link de pagamento pedido — ele entra na mensagem assim que ficar pronto."
          : r.error,
      });
    });
  }

  if (tarefas.length === 0 && suprimidas.length === 0) return null;

  return (
    <section className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Régua de cobrança de hoje
        </h2>
        <span className="text-dense tabular-nums text-muted-foreground">
          {tarefas.length} {tarefas.length === 1 ? "cobrança" : "cobranças"} ·{" "}
          {formatBRL(total)}
          {feitas.size > 0 ? ` · ${feitas.size} tratada(s)` : ""}
        </span>
        {podeCobrar && tarefas.length > 0 ? (
          <Button
            className="ml-auto"
            size="sm"
            disabled={pending || selecionadas.length === 0}
            onClick={despacharSelecionadas}
          >
            {envioIntegrado ? (
              <Send className="mr-1.5 h-4 w-4" aria-hidden />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" aria-hidden />
            )}
            {envioIntegrado ? "Enviar selecionadas" : "Copiar e marcar enviadas"}
            {selecionadas.length > 0 ? ` (${selecionadas.length})` : ""}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {podeCobrar ? (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={tarefas.length > 0 && marcadas.size === tarefas.length}
                        indeterminate={marcadas.size > 0 && marcadas.size < tarefas.length}
                        onChange={alternarTodas}
                        aria-label="Selecionar todas as cobranças da régua"
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>Cliente</TableHead>
                  <TableHead>Cobrança</TableHead>
                  <TableHead>Degrau</TableHead>
                  <TableHead className="text-right">Em aberto</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tarefas.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={podeCobrar ? 6 : 5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Nenhuma cobrança na régua hoje.
                    </TableCell>
                  </TableRow>
                ) : null}
                {tarefas.map((t) => (
                  <TableRow
                    key={t.billingId}
                    className={feitas.has(t.billingId) ? "text-muted-foreground" : ""}
                  >
                    {podeCobrar ? (
                      <TableCell>
                        <Checkbox
                          checked={marcadas.has(t.billingId)}
                          onChange={() => alternar(t.billingId)}
                          aria-label={`Selecionar a cobrança de ${t.cliente}`}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">
                      {t.cliente}
                      {feitas.has(t.billingId) ? (
                        <Badge variant="outline" className="ml-2">tratada</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-dense text-muted-foreground">
                      {t.descricao} · vence em{" "}
                      {new Intl.DateTimeFormat("pt-BR").format(new Date(t.dueDate))}
                      {t.diasDeAtraso > 0
                        ? ` · ${t.diasDeAtraso} ${t.diasDeAtraso === 1 ? "dia" : "dias"} de atraso`
                        : ""}
                      <details className="mt-1">
                        <summary className="cursor-pointer select-none text-caption">
                          Ver a mensagem pronta
                        </summary>
                        <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-surface-sunken p-2.5 text-dense">
                          {t.mensagem}
                        </pre>
                      </details>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.etapa}</Badge>
                      <p className="mt-1 text-caption text-muted-foreground">{t.objetivo}</p>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatBRL(t.valorEmAberto)}
                    </TableCell>
                    <TableCell className="text-right">
                      {podeCobrar ? (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" disabled={pending} onClick={() => despachar(t)}>
                            {envioIntegrado ? "Enviar" : "Copiar e marcar"}
                          </Button>
                          {t.whatsapp ? (
                            <Button variant="outline" size="sm" asChild>
                              <a href={t.whatsapp} target="_blank" rel="noreferrer">
                                <MessageCircle className="h-4 w-4" aria-hidden />
                                <span className="sr-only">
                                  Abrir o WhatsApp de {t.cliente}
                                </span>
                              </a>
                            </Button>
                          ) : null}
                          <Button variant="outline" size="sm" disabled={pending}
                            onClick={() => prometer(t)}>
                            Promessa
                          </Button>
                          {gatewayAtivo && !t.linkPagamento ? (
                            <Button variant="outline" size="sm" disabled={pending}
                              onClick={() => pedirLink(t)}>
                              Link
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="sm" disabled={pending}
                            onClick={() => bloquear(t)}>
                            Bloquear
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCards>
            {tarefas.length === 0 ? (
              <MobileEmpty>Nenhuma cobrança na régua hoje.</MobileEmpty>
            ) : (
              tarefas.map((t) => (
                <MobileCard key={t.billingId}>
                  <MobileCardHeader
                    title={t.cliente}
                    aside={
                      <span className="font-semibold tabular-nums">
                        {formatBRL(t.valorEmAberto)}
                      </span>
                    }
                  />
                  <div className="space-y-1.5">
                    <Field label="Degrau">
                      <Badge variant="outline">{t.etapa}</Badge>
                    </Field>
                    <Field label="Vencimento">
                      {new Intl.DateTimeFormat("pt-BR").format(new Date(t.dueDate))}
                      {t.diasDeAtraso > 0 ? ` · ${t.diasDeAtraso} dias` : ""}
                    </Field>
                  </div>
                  {podeCobrar ? (
                    <MobileCardActions>
                      <Button size="sm" disabled={pending} onClick={() => despachar(t)}>
                        {envioIntegrado ? "Enviar" : "Copiar e marcar"}
                      </Button>
                      <Button variant="outline" size="sm" disabled={pending}
                        onClick={() => prometer(t)}>
                        Promessa
                      </Button>
                    </MobileCardActions>
                  ) : null}
                </MobileCard>
              ))
            )}
          </MobileCards>
        </CardContent>
      </Card>

      {suprimidas.length > 0 ? (
        <Card className="mt-3">
          <CardContent className="p-3.5">
            <p className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Fora da régua hoje
            </p>
            <ul className="space-y-1.5">
              {suprimidas.map((s) => (
                <li key={s.billingId} className="text-dense">
                  <span className="font-medium">{s.cliente}</span> —{" "}
                  <span className="text-muted-foreground">{s.explicacao}</span>
                  {s.ate ? (
                    <span className="text-muted-foreground">
                      {" "}
                      até {new Intl.DateTimeFormat("pt-BR").format(new Date(s.ate))}
                    </span>
                  ) : null}
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    ({formatBRL(s.valorEmAberto)})
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-muted-foreground">
              Aparecem aqui de propósito: cliente que some da cobrança em
              silêncio é dívida que envelhece sem ninguém perceber.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
