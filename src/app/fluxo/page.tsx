import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission } from "@/lib/auth/viewer";
import { formatBRL } from "@/lib/format";
import { fluxoDeCaixa, HORIZONTES } from "@/lib/services/cash-flow";

/**
 * FLUXO DE CAIXA E PROJEÇÃO 30/60/90 (F3.11 · ref. 01 §7.2; 02 §4.4).
 *
 * O card principal usa LIQUIDEZ DISPONÍVEL, nunca saldo bruto (01 §7.2) — é
 * a diferença entre "tenho R$ 40 mil" e "tenho R$ 40 mil, mas R$ 18 mil são
 * do imposto de setembro".
 *
 * E a tela diz o que a projeção NÃO enxerga. Uma projeção que parece completa
 * e não é gera a decisão errada com mais confiança do que nenhuma projeção.
 */
export const dynamic = "force-dynamic";

export default async function FluxoPage() {
  await requirePagePermission("caixa.visualizar");
  const f = await fluxoDeCaixa();

  return (
    <div>
      <PageHeader
        title="Fluxo de caixa"
        description="Por data de caixa — o que entra e o que sai nos próximos 90 dias"
      />

      {f.primeiroNegativo ? (
        <Card className="mb-4 border-warning">
          <CardContent className="p-4">
            <p className="text-body font-medium text-warning">
              A liquidez projetada fica negativa em {f.primeiroNegativo} dias.
            </p>
            <p className="mt-1 text-dense text-muted-foreground">
              Decidir agora o que adiar, antecipar ou cobrar — depois de a conta
              estourar, as opções são piores e mais caras.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          title="Liquidez disponível"
          value={formatBRL(f.liquidez.disponivel)}
          basis="caixa"
          tone={f.liquidez.disponivel < 0 ? "negative" : "default"}
          hint={`${formatBRL(f.liquidez.contas + f.liquidez.reservas)} no total, ${formatBRL(f.liquidez.reservado)} restrito`}
          help="Saldo das contas e reservas menos as reservas restritas (imposto, 13º). É este número que responde 'posso gastar?', não o saldo bruto."
        />
        {f.projecoes.map((p) => (
          <MetricCard
            key={p.dias}
            title={`Projeção em ${p.dias} dias`}
            value={formatBRL(p.liquidezProjetada)}
            basis="caixa"
            tone={p.negativa ? "negative" : "positive"}
            hint={`+${formatBRL(p.entradas)} · −${formatBRL(p.saidas)}`}
          />
        ))}
      </div>

      <h2 className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Por conta
      </h2>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-dense">
            <thead>
              <tr className="border-b border-border-soft text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="px-3.5 py-2 font-medium">Conta</th>
                <th className="px-3.5 py-2 text-right font-medium">Saldo hoje</th>
                {HORIZONTES.map((d) => (
                  <th key={d} className="px-3.5 py-2 text-right font-medium">
                    A pagar {d}d
                  </th>
                ))}
                {HORIZONTES.map((d) => (
                  <th key={`p${d}`} className="px-3.5 py-2 text-right font-medium">
                    Saldo {d}d
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {f.contas.map((c) => (
                <tr key={c.accountId ?? "sem-conta"} className="border-b border-border-soft last:border-0">
                  <td className="px-3.5 py-2">
                    {c.nome}
                    {c.accountId === null ? (
                      <Badge variant="outline" className="ml-2">
                        sem conta
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3.5 py-2 text-right tabular-nums">
                    {formatBRL(c.saldoAtual)}
                  </td>
                  {HORIZONTES.map((d) => (
                    <td key={d} className="px-3.5 py-2 text-right tabular-nums text-muted-foreground">
                      {c.saidas[d] > 0 ? formatBRL(c.saidas[d]) : "—"}
                    </td>
                  ))}
                  {HORIZONTES.map((d) => (
                    <td
                      key={`p${d}`}
                      className={`px-3.5 py-2 text-right tabular-nums ${
                        c.saldoProjetado[d] < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {formatBRL(c.saldoProjetado[d])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="mt-3 text-dense text-muted-foreground">
        A tabela por conta mostra só as SAÍDAS: despesa escolhe a conta que
        paga, recebimento não escolhe a conta que recebe antes de o dinheiro
        cair. Distribuir as entradas entre as contas seria inventar um número —
        elas entram no consolidado acima.
      </p>
      <p className="mt-1.5 text-dense text-muted-foreground">{f.aviso}</p>
    </div>
  );
}
