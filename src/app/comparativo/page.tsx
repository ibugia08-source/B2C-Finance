import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission } from "@/lib/auth/viewer";
import { compararPeriodos } from "@/lib/services/period-compare";
import { formatBRL, monthLabel } from "@/lib/format";
import { SeletorDeMeses } from "./seletor";

/**
 * COMPARAR DOIS MESES (F2.5 · ref. 02 §5.3, §7.8).
 *
 * "Duas colunas com deltas na coluna CENTRAL" — o delta no meio, e não numa
 * terceira coluna à direita, porque a leitura é sempre A → variação → B. Com
 * a variação na ponta, o olho tem de voltar duas colunas para saber de onde
 * o número veio.
 */
export const dynamic = "force-dynamic";

function competenciaValida(v: string | undefined, padrao: Date): string {
  if (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  return `${padrao.getFullYear()}-${String(padrao.getMonth() + 1).padStart(2, "0")}`;
}

export default async function ComparativoPage({
  searchParams,
}: {
  searchParams?: { a?: string; b?: string };
}) {
  await requirePagePermission("relatorios.visualizar");

  const hoje = new Date();
  const compA = competenciaValida(searchParams?.a, new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1));
  const compB = competenciaValida(searchParams?.b, hoje);

  const c = await compararPeriodos(compA, compB);
  const rotulo = (comp: string) => {
    const [ano, mes] = comp.split("-").map(Number);
    return monthLabel(new Date(ano, mes - 1, 1));
  };

  const fmt = (v: number | null, formato: string) => {
    if (v == null) return "—";
    if (formato === "BRL") return formatBRL(v);
    if (formato === "PCT") return `${(v * 100).toFixed(1).replace(".", ",")}%`;
    return String(Math.round(v));
  };

  return (
    <div>
      <PageHeader
        title="Comparar dois meses"
        description="Lado a lado, com a variação no meio — e cada lado dizendo se veio da fotografia ou do cálculo de agora"
      />

      <SeletorDeMeses a={compA} b={compB} />

      {!c.mesmaRegua ? (
        <div className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-dense text-warning-foreground">
          Os dois meses foram medidos com versões diferentes do dicionário de
          métricas (v{c.a.versaoMetricas} e v{c.b.versaoMetricas}). A diferença
          entre eles inclui a mudança de fórmula, não só a mudança do negócio.
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border text-caption uppercase tracking-wide text-muted-foreground">
                <th className="px-3.5 py-2.5 text-left font-medium">Indicador</th>
                <th className="px-3.5 py-2.5 text-right font-medium">
                  {rotulo(compA)}
                  <Fonte lado={c.a.fonte} />
                </th>
                <th className="px-3.5 py-2.5 text-center font-medium">Variação</th>
                <th className="px-3.5 py-2.5 text-right font-medium">
                  {rotulo(compB)}
                  <Fonte lado={c.b.fonte} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {c.linhas.map((l) => {
                const bom =
                  l.delta == null || l.delta === 0
                    ? null
                    : l.subirEhBom
                      ? l.delta > 0
                      : l.delta < 0;
                return (
                  <tr key={l.chave}>
                    <td className="px-3.5 py-2">{l.rotulo}</td>
                    <td className="px-3.5 py-2 text-right tabular-nums">
                      {fmt(l.a, l.formato)}
                    </td>
                    <td className="px-3.5 py-2 text-center">
                      {l.delta == null ? (
                        <span className="text-text-faint">—</span>
                      ) : (
                        <span
                          className={
                            bom === null
                              ? "text-muted-foreground"
                              : bom
                                ? "text-success"
                                : "text-danger"
                          }
                        >
                          <span className="tabular-nums">
                            {l.delta > 0 ? "+" : ""}
                            {fmt(l.delta, l.formato)}
                          </span>
                          {l.variacao != null ? (
                            <span className="ml-1 text-caption">
                              ({l.variacao > 0 ? "+" : ""}
                              {(l.variacao * 100).toFixed(0)}%)
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-2 text-right tabular-nums">
                      {fmt(l.b, l.formato)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <h2 className="mb-2 mt-6 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Leitura da carteira
      </h2>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border text-caption uppercase tracking-wide text-muted-foreground">
                <th className="px-3.5 py-2.5 text-left font-medium">Estabilidade</th>
                <th className="px-3.5 py-2.5 text-right font-medium">{rotulo(compA)}</th>
                <th className="px-3.5 py-2.5 text-center font-medium">Variação</th>
                <th className="px-3.5 py-2.5 text-right font-medium">{rotulo(compB)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {[...new Set([...Object.keys(c.estabilidade.a), ...Object.keys(c.estabilidade.b)])]
                .sort()
                .map((nivel) => {
                  const va = c.estabilidade.a[nivel] ?? 0;
                  const vb = c.estabilidade.b[nivel] ?? 0;
                  const d = vb - va;
                  return (
                    <tr key={nivel}>
                      <td className="px-3.5 py-2">{nivel}</td>
                      <td className="px-3.5 py-2 text-right tabular-nums">{va}</td>
                      <td className="px-3.5 py-2 text-center tabular-nums text-muted-foreground">
                        {d === 0 ? "—" : d > 0 ? `+${d}` : d}
                      </td>
                      <td className="px-3.5 py-2 text-right tabular-nums">{vb}</td>
                    </tr>
                  );
                })}
              {Object.keys(c.estabilidade.a).length === 0 &&
              Object.keys(c.estabilidade.b).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3.5 py-6 text-center text-muted-foreground">
                    Nenhum dos dois meses tem avaliação confirmada.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/** De onde veio o número deste lado — a informação que evita comparar laranja com maçã. */
function Fonte({ lado }: { lado: "fotografia" | "cálculo" }) {
  return (
    <Badge
      variant={lado === "fotografia" ? "warning" : "outline"}
      className="ml-2 align-middle text-[10px] font-normal normal-case"
    >
      {lado === "fotografia" ? "fotografia" : "cálculo de agora"}
    </Badge>
  );
}
