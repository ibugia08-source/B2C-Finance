import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission } from "@/lib/auth/viewer";
import { montarDre } from "@/lib/services/dre";
import { formatBRL, formatPercent, monthLabel } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { FiltrosDre } from "./filtros";
import { competenciaDaUrl } from "@/lib/competence";

/**
 * DRE GERENCIAL (F3.2 · ref. 01 §3.11; 02 §4.5).
 *
 * A tela existe para responder "quanto sobrou no mês, e de onde veio".
 *
 * A FAIXA DE COBERTURA no topo não é um aviso técnico: é a informação sem a
 * qual o número embaixo dela não pode ser usado. Um DRE tirado de um razão
 * que cobre metade dos fatos não está "quase pronto" — está errado, e quem
 * abre a tela tem de saber disso antes de decidir qualquer coisa.
 */
export const dynamic = "force-dynamic";

export default async function DrePage({
  searchParams,
}: {
  searchParams?: { mes?: string; base?: string; agencia?: string; prolabore?: string };
}) {
  await requirePagePermission("contabil.visualizar");

  const { competence, ano, mes } = competenciaDaUrl(searchParams?.mes);
  const base = searchParams?.base === "caixa" ? "caixa" : "competencia";
  const agencyId = searchParams?.agencia || null;
  const comProLabore = searchParams?.prolabore !== "fora";

  const [dre, agencias] = await Promise.all([
    montarDre(competence, { base, agencyId, comProLabore }),
    runWithoutScope(async () =>
      prisma.agency.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    ),
  ]);

  const semCobertura = dre.cobertura.eventosSemUso.length;

  return (
    <div>
      <PageHeader
        title="Resultado gerencial (DRE)"
        description={`${monthLabel(new Date(ano, mes - 1, 1))} — por ${base === "caixa" ? "caixa" : "competência"}, direto do razão`}
        actions={
          <Link
            href={`/api/dre/csv?mes=${competence}&base=${base}${agencyId ? `&agencia=${agencyId}` : ""}${comProLabore ? "" : "&prolabore=fora"}`}
            className="inline-flex h-9 items-center rounded-input border border-border px-3.5 text-sm font-medium hover:bg-surface-raised"
          >
            Exportar para o contador
          </Link>
        }
      />

      <FiltrosDre
        competence={competence}
        base={base}
        agencyId={agencyId}
        agencias={agencias}
        comProLabore={comProLabore}
      />

      {/* A cobertura vem ANTES dos números, de propósito. */}
      {!dre.cobertura.ligado || semCobertura > 0 ? (
        <div className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-3.5 py-3 text-dense text-warning-foreground">
          <p className="font-medium">
            {!dre.cobertura.ligado
              ? "O razão está desligado neste ambiente."
              : `${semCobertura} dos 17 tipos de lançamento ainda não são gerados pelo produto.`}
          </p>
          <p className="mt-0.5 text-warning-foreground/90">
            {!dre.cobertura.ligado
              ? "Sem ele não há lançamentos, e este DRE fica vazio. Ligar em produção depende do lançamento de abertura."
              : "As linhas correspondentes aparecem zeradas aqui — não porque valem zero, mas porque ainda não existe tela que as origine. Cada uma entra com a tarefa dela."}
          </p>
          {dre.cobertura.diferenca != null && Math.abs(dre.cobertura.diferenca) > 0.01 ? (
            <p className="mt-1 font-medium">
              A receita no razão está {formatBRL(Math.abs(dre.cobertura.diferenca))}{" "}
              {dre.cobertura.diferenca < 0 ? "abaixo" : "acima"} da receita que o
              painel mostra ({formatBRL(dre.cobertura.receitaOperacionalMedida ?? 0)}).
            </p>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-body">
            <tbody>
              {dre.blocos.map((b) => {
                if (b.linhas.length === 0) return null;
                return (
                  <>
                    <tr key={b.chave} className="border-y border-border bg-surface-sunken">
                      <td className="px-3.5 py-2 font-medium">{b.titulo}</td>
                      <td className="px-3.5 py-2 text-right font-medium tabular-nums">
                        {b.sinal === -1 ? "−" : ""}
                        {formatBRL(b.total)}
                      </td>
                    </tr>
                    {b.linhas.map((l) => (
                      <tr key={l.code} className="border-b border-border-soft">
                        <td className="px-3.5 py-1.5 pl-8 text-muted-foreground">
                          <span className="font-mono text-caption">{l.code}</span> {l.name}
                          {l.code === "7.5" && !comProLabore ? (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              fora do resultado
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3.5 py-1.5 text-right tabular-nums text-muted-foreground">
                          {formatBRL(l.valor)}
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}

              <Totalizador rotulo="Receita total" valor={dre.receitaTotal} />
              <Totalizador rotulo="(−) Custos diretos" valor={-dre.custosDiretos} />
              <Totalizador rotulo="(=) Margem bruta" valor={dre.margemBruta} destaque />
              <Totalizador rotulo="(−) Despesas" valor={-dre.despesas} />
              <Totalizador rotulo="(=) Resultado gerencial" valor={dre.resultado} destaque />
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Resumo
          rotulo="Margem gerencial"
          valor={dre.margem == null ? "—" : formatPercent(dre.margem)}
        />
        <Resumo rotulo="Pró-labore no mês" valor={formatBRL(dre.proLabore)} />
        <Resumo
          rotulo="Resultado sem pró-labore"
          valor={formatBRL(dre.resultadoSemProLabore)}
        />
      </div>

      <p className="mt-3 text-caption text-muted-foreground">
        {dre.lancamentos} lançamentos do razão entraram nesta leitura. Decisão
        19.12: o pró-labore fica dentro do resultado por ser custo real de
        operar; a chave acima mostra a operação antes da retirada.
      </p>
    </div>
  );
}

function Totalizador({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <tr className={destaque ? "border-y border-border bg-surface-sunken" : ""}>
      <td className={`px-3.5 py-2 ${destaque ? "font-semibold" : "font-medium"}`}>{rotulo}</td>
      <td
        className={`px-3.5 py-2 text-right tabular-nums ${destaque ? "font-semibold" : "font-medium"} ${
          destaque && valor < 0 ? "text-danger" : ""
        }`}
      >
        {formatBRL(valor)}
      </td>
    </tr>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <p className="text-caption text-muted-foreground">{rotulo}</p>
        <p className="mt-0.5 text-emphasis font-semibold tabular-nums">{valor}</p>
      </CardContent>
    </Card>
  );
}
