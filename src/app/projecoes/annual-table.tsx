import { Card, CardContent } from "@/components/ui/card";
import { formatBRL0, MONTHS_PT_SHORT } from "@/lib/format";
import type { AnnualPanel } from "@/lib/services/annual-panel";

/**
 * Tabela do PAINEL ANUAL — indicador × JAN..DEZ + ACUMULADO, os mesmos
 * grupos da planilha do dono (RECEITAS / DESPESAS / RESULTADO / MÉTRICAS).
 * Meses futuros ficam "—". Verde/vermelho seguem os tokens do design system.
 */

const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

type CellKind = "money" | "moneySigned" | "pct" | "pctSigned" | "int";

type RowSpec = {
  label: string;
  values: (number | null)[];
  acumulado: number | null;
  kind: CellKind;
  strong?: boolean;
};

function fmt(v: number | null, kind: CellKind): { text: string; cls: string } {
  if (v == null) return { text: "—", cls: "text-muted-foreground/60" };
  switch (kind) {
    case "money":
      return { text: formatBRL0(v), cls: "" };
    case "moneySigned":
      return {
        text: v < 0 ? `(${formatBRL0(Math.abs(v))})` : formatBRL0(v),
        cls: v < 0 ? "text-destructive" : "text-success",
      };
    case "pct":
      return { text: pct(v), cls: "" };
    case "pctSigned":
      return { text: pct(v), cls: v < 0 ? "text-destructive" : "text-success" };
    case "int":
      return { text: String(Math.round(v)), cls: "" };
  }
}

function Row({ row }: { row: RowSpec }) {
  return (
    <tr className={`border-b last:border-0 ${row.strong ? "font-semibold" : ""}`}>
      <td className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs whitespace-nowrap border-r">
        {row.label}
      </td>
      {row.values.map((v, i) => {
        const f = fmt(v, row.kind);
        return (
          <td key={i} className={`px-2.5 py-2 text-right text-xs tabular-nums whitespace-nowrap ${f.cls}`}>
            {f.text}
          </td>
        );
      })}
      {(() => {
        const f = fmt(row.acumulado, row.kind);
        return (
          <td className={`px-3 py-2 text-right text-xs tabular-nums font-semibold whitespace-nowrap bg-muted/40 ${f.cls}`}>
            {f.text}
          </td>
        );
      })()}
    </tr>
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <tr>
      <td
        colSpan={14}
        className="sticky left-0 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary"
      >
        {label}
      </td>
    </tr>
  );
}

export function AnnualTable({ panel }: { panel: AnnualPanel }) {
  const upto = panel.lastMonthWithData;
  // Valor do mês, ou null para meses futuros (vira "—").
  const val = (arr: number[]) => arr.map((v, i) => (i <= upto ? v : null));
  const sumUpto = (arr: number[]) =>
    upto < 0 ? null : arr.slice(0, upto + 1).reduce((s, v) => s + v, 0);

  const recebidoVals = val(panel.recebido);
  const esperadoVals = val(panel.esperado);

  const realizacao = panel.recebido.map((r, i) =>
    i <= upto && panel.esperado[i] > 0 ? r / panel.esperado[i] : null
  );
  const mom = panel.recebido.map((r, i) =>
    i === 0 || i > upto || panel.recebido[i - 1] <= 0 ? null : r / panel.recebido[i - 1] - 1
  );
  const pctFolha = panel.folha.map((f, i) =>
    i <= upto && panel.recebido[i] > 0 ? f / panel.recebido[i] : null
  );
  const margem = panel.resultado.map((r, i) =>
    i <= upto && panel.recebido[i] > 0 ? r / panel.recebido[i] : null
  );
  const ticket = panel.recebido.map((r, i) =>
    i <= upto && panel.clientesAtivos[i] > 0 ? r / panel.clientesAtivos[i] : null
  );
  const reserva = panel.resultado.map((r, i) =>
    i <= upto && r > 0 ? r * 0.7 : i <= upto ? 0 : null
  );
  const distribuicao = panel.resultado.map((r, i) =>
    i <= upto && r > 0 ? r * 0.3 : i <= upto ? 0 : null
  );

  const totalEsperado = sumUpto(panel.esperado);
  const totalRecebido = sumUpto(panel.recebido);
  const totalResultado = sumUpto(panel.resultado);
  const totalFolha = sumUpto(panel.folha);
  const ativosMedio =
    upto >= 0
      ? panel.clientesAtivos.slice(0, upto + 1).filter((v) => v > 0)
      : [];

  const rows: (RowSpec | { group: string })[] = [
    { group: "Receitas" },
    { label: "Faturamento esperado", values: esperadoVals, acumulado: totalEsperado, kind: "money" },
    { label: "Faturamento recebido", values: recebidoVals, acumulado: totalRecebido, kind: "money", strong: true },
    { label: "Novos clientes (valor)", values: val(panel.novosClientesValor), acumulado: sumUpto(panel.novosClientesValor), kind: "money" },
    { label: "Outras entradas", values: val(panel.outrasEntradas), acumulado: sumUpto(panel.outrasEntradas), kind: "money" },
    {
      label: "% Realização (recebido/esperado)",
      values: realizacao,
      acumulado:
        totalEsperado && totalEsperado > 0 && totalRecebido != null
          ? totalRecebido / totalEsperado
          : null,
      kind: "pct",
    },
    { label: "Crescimento MoM", values: mom, acumulado: null, kind: "pctSigned" },

    { group: "Despesas" },
    { label: "Total de despesas", values: val(panel.despesas), acumulado: sumUpto(panel.despesas), kind: "money", strong: true },
    { label: "Folha de pagamento", values: val(panel.folha), acumulado: totalFolha, kind: "money" },
    { label: "Custos com tráfego (ADS)", values: val(panel.trafego), acumulado: sumUpto(panel.trafego), kind: "money" },
    { label: "Comissão comercial", values: val(panel.comissao), acumulado: sumUpto(panel.comissao), kind: "money" },
    {
      label: "% Folha / Faturamento",
      values: pctFolha,
      acumulado:
        totalFolha != null && totalRecebido && totalRecebido > 0
          ? totalFolha / totalRecebido
          : null,
      kind: "pct",
    },

    { group: "Resultado" },
    { label: "Lucro / Prejuízo", values: val(panel.resultado), acumulado: totalResultado, kind: "moneySigned", strong: true },
    {
      label: "Margem operacional",
      values: margem,
      acumulado:
        totalResultado != null && totalRecebido && totalRecebido > 0
          ? totalResultado / totalRecebido
          : null,
      kind: "pctSigned",
    },
    { label: "Distribuição de lucro (30%)", values: distribuicao, acumulado: sumUpto(panel.resultado.map((r) => (r > 0 ? r * 0.3 : 0))), kind: "money" },
    { label: "Reserva de caixa (70%)", values: reserva, acumulado: sumUpto(panel.resultado.map((r) => (r > 0 ? r * 0.7 : 0))), kind: "money" },

    { group: "Métricas" },
    { label: "Clientes no ciclo do mês", values: val(panel.clientesAtivos), acumulado: ativosMedio.length ? ativosMedio.reduce((s, v) => s + v, 0) / ativosMedio.length : null, kind: "int" },
    { label: "Novos clientes (qtde)", values: val(panel.novosClientesQtde), acumulado: sumUpto(panel.novosClientesQtde), kind: "int" },
    { label: "Churn (qtde)", values: val(panel.churnQtde), acumulado: sumUpto(panel.churnQtde), kind: "int" },
    { label: "Churn (valor)", values: val(panel.churnValor), acumulado: sumUpto(panel.churnValor), kind: "money" },
    { label: "Ticket médio", values: ticket, acumulado: totalRecebido != null && ativosMedio.length ? totalRecebido / ativosMedio.reduce((s, v) => s + v, 0) : null, kind: "money" },
  ];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="relative w-full overflow-auto">
          <table className="w-full caption-bottom text-sm">
            <thead className="sticky top-0 z-20 bg-muted/60 backdrop-blur">
              <tr className="border-b">
                <th className="sticky left-0 z-30 bg-muted px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-r">
                  Indicador
                </th>
                {MONTHS_PT_SHORT.map((m) => (
                  <th
                    key={m}
                    className="px-2.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {m}
                  </th>
                ))}
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted">
                  Acumulado
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) =>
                "group" in r ? (
                  <GroupHeader key={`g-${r.group}`} label={r.group} />
                ) : (
                  <Row key={`${r.label}-${i}`} row={r} />
                )
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
