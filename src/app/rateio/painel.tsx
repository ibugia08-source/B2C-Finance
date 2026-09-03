"use client";
import { useMemo, useState, useTransition } from "react";
import { Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { showUndoToast } from "@/components/undo-toast";
import { formatBRL, parseBRL } from "@/lib/format";
import { distribuirPorPeso } from "@/lib/allocations/split";
import { aplicarRegrasAction, salvarRateioAction } from "@/lib/actions/rateio";
import type { DespesaParaRatear } from "@/lib/services/allocation";

type Opcao = { id: string; name: string };
type Dimensao = "CLIENT" | "AGENCY" | "SERVICE";

const ROTULO_DIMENSAO: Record<Dimensao, string> = {
  CLIENT: "Cliente",
  AGENCY: "Agência",
  SERVICE: "Serviço",
};

/**
 * A lista de mídia do mês e o diálogo que distribui uma linha.
 *
 * A distribuição é por PESO, não por percentual digitado: "estes quatro
 * clientes, este com o dobro" é o gesto real de quem faz isso todo mês, e o
 * percentual sai da conta. Digitar percentuais que somem exatamente 100 é uma
 * tarefa de planilha — e é onde some o centavo.
 *
 * A prévia mostra os valores JÁ arredondados pelo mesmo código que grava
 * (`distribuirPorPeso`). Se a tela calculasse por conta própria, um dia a
 * prévia e o gravado divergiriam em um centavo e ninguém saberia qual está
 * certo.
 */
export function PainelDeRateio({
  competence,
  despesas,
  clientes,
  agencias,
  servicos,
  regrasAtivas,
  podeEditar,
}: {
  competence: string;
  despesas: DespesaParaRatear[];
  clientes: Opcao[];
  agencias: Opcao[];
  servicos: Opcao[];
  regrasAtivas: number;
  podeEditar: boolean;
}) {
  const [lista, setLista] = useState(despesas);
  const [aberta, setAberta] = useState<DespesaParaRatear | null>(null);
  const [pending, start] = useTransition();

  const semDono = lista.filter((d) => d.naoAlocado > 0.005).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-dense text-muted-foreground">
          {semDono === 0
            ? "Todo o gasto de mídia deste mês tem dono."
            : `${semDono} ${semDono === 1 ? "lançamento tem" : "lançamentos têm"} valor sem dono.`}
        </p>
        {podeEditar ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending || regrasAtivas === 0}
            title={
              regrasAtivas === 0
                ? "Nenhuma regra de rateio ativa — crie em Regras de categoria e rateio."
                : "Aplica as regras às linhas que ainda não têm rateio nenhum."
            }
            onClick={() =>
              start(async () => {
                const r = await aplicarRegrasAction(competence);
                if (!r.ok) return showUndoToast({ message: r.error });
                showUndoToast({
                  message:
                    r.aplicadas === 0
                      ? `Nenhuma regra casou. ${r.semRegra} ${r.semRegra === 1 ? "lançamento continua" : "lançamentos continuam"} para distribuir à mão.`
                      : `${r.aplicadas} ${r.aplicadas === 1 ? "lançamento rateado" : "lançamentos rateados"} (${formatBRL(r.valor)}).`,
                });
                location.reload();
              })
            }
          >
            <Wand2 className="mr-1.5 h-4 w-4" aria-hidden />
            Aplicar regras
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        {lista.map((d) => (
          <Card key={d.sourceId}>
            <CardContent className="p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium">{d.descricao}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {new Intl.DateTimeFormat("pt-BR").format(new Date(d.data))}
                    {d.cartao ? ` · ${d.cartao}` : ""}
                    {d.categoria ? ` · ${d.categoria}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="stat-number whitespace-nowrap font-semibold">
                    {formatBRL(d.total)}
                  </p>
                  {d.naoAlocado > 0.005 ? (
                    <Badge variant="warning" className="mt-1">
                      {formatBRL(d.naoAlocado)} sem dono
                    </Badge>
                  ) : (
                    <Badge variant="success" className="mt-1">
                      rateado
                    </Badge>
                  )}
                </div>
              </div>

              {d.linhas.length > 0 ? (
                <ul className="mt-2.5 divide-y divide-border-soft border-t border-border-soft">
                  {d.linhas.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-2 py-1.5 text-dense"
                    >
                      <span className="min-w-0 truncate">
                        {l.nome}
                        {l.ruleName ? (
                          <span className="ml-1.5 text-caption text-muted-foreground">
                            regra “{l.ruleName}”
                          </span>
                        ) : null}
                      </span>
                      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {l.percentage != null ? `${l.percentage.toFixed(1)}% · ` : ""}
                        {formatBRL(l.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {podeEditar ? (
                <div className="mt-2.5">
                  <Button variant="outline" size="sm" onClick={() => setAberta(d)}>
                    {d.linhas.length === 0 ? "Distribuir" : "Ajustar rateio"}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {aberta ? (
        <DialogoDeRateio
          despesa={aberta}
          clientes={clientes}
          agencias={agencias}
          servicos={servicos}
          onFechar={() => setAberta(null)}
          onSalvo={(atualizada) => {
            setLista((atual) =>
              atual.map((d) => (d.sourceId === atualizada.sourceId ? atualizada : d))
            );
            setAberta(null);
          }}
        />
      ) : null}
    </>
  );
}

function DialogoDeRateio({
  despesa,
  clientes,
  agencias,
  servicos,
  onFechar,
  onSalvo,
}: {
  despesa: DespesaParaRatear;
  clientes: Opcao[];
  agencias: Opcao[];
  servicos: Opcao[];
  onFechar: () => void;
  onSalvo: (d: DespesaParaRatear) => void;
}) {
  const dimensaoInicial =
    (despesa.linhas[0]?.dimensionType as Dimensao | undefined) ?? "CLIENT";
  const [dimensao, setDimensao] = useState<Dimensao>(dimensaoInicial);
  const [pesos, setPesos] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      despesa.linhas
        .filter((l) => l.dimensionType === dimensaoInicial)
        .map((l) => [l.dimensionId, Math.round(l.amount * 100)])
    )
  );
  // Distribuir só uma PARTE é o caso normal (o resto é campanha da agência).
  const [valor, setValor] = useState<string>(String(despesa.total.toFixed(2)));
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const opcoes = dimensao === "CLIENT" ? clientes : dimensao === "AGENCY" ? agencias : servicos;
  const aRatear = Math.max(0, parseBRL(valor) || 0);

  const previa = useMemo(() => {
    const escolhidos = Object.keys(pesos).filter((id) => pesos[id] > 0);
    if (escolhidos.length === 0 || aRatear <= 0) return [];
    return distribuirPorPeso(
      Math.min(aRatear, despesa.total),
      escolhidos.map((id) => ({ id, peso: pesos[id] }))
    );
  }, [pesos, aRatear, despesa.total]);

  const somaPrevia = previa.reduce((s, f) => s + f.amount, 0);
  const sobra = Math.round((despesa.total - somaPrevia) * 100) / 100;

  function alternar(id: string) {
    setPesos((p) => {
      const novo = { ...p };
      if (novo[id]) delete novo[id];
      else novo[id] = 1;
      return novo;
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Distribuir {formatBRL(despesa.total)}</DialogTitle>
        </DialogHeader>

        <p className="text-dense text-muted-foreground">{despesa.descricao}</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rateio-dimensao">Distribuir entre</Label>
            <Select
              id="rateio-dimensao"
              value={dimensao}
              onChange={(e) => {
                setDimensao(e.target.value as Dimensao);
                setPesos({});
              }}
            >
              {(["CLIENT", "AGENCY", "SERVICE"] as Dimensao[]).map((d) => (
                <option key={d} value={d}>
                  {ROTULO_DIMENSAO[d]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rateio-valor">Valor a distribuir</Label>
            <Input
              id="rateio-valor"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
        </div>

        <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
          {opcoes.length === 0 ? (
            <p className="py-3 text-center text-dense text-muted-foreground">
              Nada cadastrado nesta dimensão.
            </p>
          ) : (
            opcoes.map((o) => {
              const marcado = !!pesos[o.id];
              return (
                <div key={o.id} className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-dense">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={marcado}
                      onChange={() => alternar(o.id)}
                    />
                    <span className="truncate">{o.name}</span>
                  </label>
                  {marcado ? (
                    <Input
                      className="h-8 w-16 text-right"
                      inputMode="numeric"
                      aria-label={`Peso de ${o.name}`}
                      value={String(pesos[o.id])}
                      onChange={(e) =>
                        setPesos((p) => ({
                          ...p,
                          [o.id]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {previa.length > 0 ? (
          <div className="rounded-md bg-surface-sunken p-2.5">
            <ul className="space-y-1">
              {previa.map((f) => (
                <li key={f.id} className="flex justify-between text-dense">
                  <span className="min-w-0 truncate">
                    {opcoes.find((o) => o.id === f.id)?.name ?? f.id}
                  </span>
                  <span className="tabular-nums">
                    {f.percentage.toFixed(1)}% · {formatBRL(f.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 border-t border-border-soft pt-1.5 text-dense">
              Fica sem dono:{" "}
              <strong className={sobra > 0.005 ? "text-warning" : ""}>
                {formatBRL(sobra)}
              </strong>
            </p>
          </div>
        ) : null}

        {erro ? <p className="text-dense text-destructive">{erro}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setErro(null);
                const r = await salvarRateioAction({
                  sourceId: despesa.sourceId,
                  linhas: previa.map((f) => ({
                    dimensionType: dimensao,
                    dimensionId: f.id,
                    amount: f.amount,
                    percentage: f.percentage,
                    method: "PROPORTIONAL",
                  })),
                });
                if (!r.ok) return setErro(r.error);
                showUndoToast({
                  message:
                    previa.length === 0
                      ? "Rateio removido."
                      : `Rateado em ${previa.length} ${previa.length === 1 ? "linha" : "linhas"}.`,
                });
                onSalvo({
                  ...despesa,
                  alocado: Math.round(somaPrevia * 100) / 100,
                  naoAlocado: Math.max(0, sobra),
                  linhas: previa.map((f) => ({
                    id: f.id,
                    dimensionType: dimensao,
                    dimensionId: f.id,
                    nome: opcoes.find((o) => o.id === f.id)?.name ?? f.id,
                    amount: f.amount,
                    percentage: f.percentage,
                    method: "PROPORTIONAL" as const,
                    ruleId: null,
                    ruleName: null,
                  })),
                });
              })
            }
          >
            {previa.length === 0 ? "Limpar rateio" : "Salvar rateio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
