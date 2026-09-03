import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { avulsasDe } from "@/lib/snapshots/engine";
import { Avulsas } from "./avulsas";
import { SnapshotBanner, NaoExistiaNoPeriodo } from "@/components/snapshot-banner";
import { areaDisponivel, conferirChecksum, lerFotografia } from "@/lib/snapshots/read";
import { formatBRL, monthLabel } from "@/lib/format";
import { METRIC_REGISTRY } from "@/lib/metrics/registry";
import { competenciaDaUrl } from "@/lib/competence";

/**
 * A FOTOGRAFIA DO MÊS (F2.4 · ref. 02 §7.8).
 *
 * Como o mês ficou quando fechou — e só isso. Nenhum controle de edição
 * existe aqui, e não por estarem desabilitados: eles simplesmente não são
 * renderizados. Controle desabilitado promete que a ação vai ser possível; a
 * pessoa clica, nada acontece, e tenta de novo.
 */
export const dynamic = "force-dynamic";

const ROTULO_AREA: Record<string, string> = {
  carteira: "Carteira",
  termos_vigentes: "Preços vigentes",
  receber: "A receber e atraso",
  pagar: "A pagar",
  caixa_reservas: "Contas e reservas",
  folha: "Folha",
  avaliacao: "Avaliação dos clientes",
  indicadores: "Indicadores",
  funil: "Funil comercial",
  dre_razao_resumido: "DRE e razão",
};

export default async function FotografiaPage({
  searchParams,
}: {
  searchParams?: { mes?: string };
}) {
  const viewer = await requirePagePermission("fechamento.fechar");

  const hoje = new Date();
  const padrao = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const { competence, ano, mes } = competenciaDaUrl(searchParams?.mes, padrao);

  const [foto, avulsas] = await Promise.all([
    lerFotografia(competence),
    avulsasDe(competence),
  ]);
  const podeFotografar = can(viewer, "fechamento.fotografar");

  if (!foto) {
    return (
      <div>
        <PageHeader
          title="Fotografia do mês"
          description={`${monthLabel(new Date(ano, mes - 1, 1))} — como o mês ficou quando fechou`}
        />
        <Avulsas competence={competence} lista={avulsas} podeCriar={podeFotografar} />
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="Este mês ainda não foi fechado"
              description="A fotografia nasce no fechamento. Enquanto o mês está aberto, os números são os de agora e mudam a cada lançamento."
              action={
                <Link
                  href={`/fechamento?mes=${competence}`}
                  className="inline-flex h-9 items-center rounded-input bg-brand px-3.5 text-sm font-medium text-brand-foreground"
                >
                  Ver o que falta para fechar
                </Link>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const integridade = conferirChecksum(foto);
  const indicadores = (foto.areas.indicadores ?? {}) as Record<string, any>;

  const contar = (area: string): number | null => {
    const a = foto.areas[area];
    if (Array.isArray(a)) return a.length;
    return null;
  };

  return (
    // Tintura de papel (02 §7.8): o canvas da fotografia é 2% mais quente,
    // para o olho saber que saiu do sistema vivo antes de ler qualquer número.
    <div className="rounded-modal bg-[color-mix(in_oklab,var(--surface-raised)_97%,#c8922a)] p-4 sm:p-5">
      <PageHeader
        title="Fotografia do mês"
        description={`${monthLabel(new Date(ano, mes - 1, 1))} — como o mês ficou quando fechou`}
        actions={
          <Link
            href={`/fechamento/fotografia/documento?mes=${competence}`}
            className="inline-flex h-9 items-center rounded-input border border-border px-3.5 text-sm font-medium hover:bg-surface-raised"
          >
            Documento em PDF
          </Link>
        }
      />

      <SnapshotBanner
        competence={foto.competence}
        versao={foto.versao}
        fechadoPor={foto.fechadoPor}
        fechadoEm={foto.fechadoEm}
        precisaRevalidar={foto.precisaRevalidar}
      />

      <Avulsas competence={competence} lista={avulsas} podeCriar={podeFotografar} />

      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-dense lg:grid-cols-4">
          <Campo rotulo="Formato" valor={`v${foto.schemaVersion}`} />
          <Campo rotulo="Dicionário de métricas" valor={`v${foto.metricVersion}`} />
          <Campo
            rotulo="Fatos lidos até"
            valor={foto.sourceCutoffAt.toLocaleString("pt-BR")}
          />
          <Campo
            rotulo="Conferência"
            valor={integridade.ok ? "assinatura confere" : `divergência: ${integridade.areasDivergentes.join(", ")}`}
          />
          <div className="col-span-2 lg:col-span-4">
            <p className="text-caption text-muted-foreground">
              Assinatura: <code className="font-mono">{foto.checksum.slice(0, 16)}…</code>
            </p>
          </div>
        </CardContent>
      </Card>

      <h2 className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Indicadores no fechamento
      </h2>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(indicadores).slice(0, 8).map(([chave, v]) => {
          const def = METRIC_REGISTRY.find((m) => m.key === chave);
          const valor = (v as any)?.valor;
          return (
            <Card key={chave}>
              <CardContent className="p-3.5">
                <p className="text-caption text-muted-foreground">{def?.name ?? chave}</p>
                <p className="mt-0.5 text-emphasis font-semibold tabular-nums">
                  {valor == null
                    ? "—"
                    : def?.rounding?.includes("%")
                      ? `${Math.round(valor * 100)}%`
                      : def?.rounding?.includes("half-up, 2 casas")
                        ? formatBRL(valor)
                        : String(valor)}
                </p>
                {(v as any)?.base ? (
                  <Badge variant="outline" className="mt-1.5 text-[10px]">
                    {(v as any).base}
                  </Badge>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        O que ficou guardado
      </h2>
      <Card>
        <CardContent className="divide-y divide-border-soft p-0">
          {Object.keys(foto.areas).sort().map((area) => {
            const disponivel = areaDisponivel(foto, area);
            const qtd = contar(area);
            return (
              <div key={area} className="flex flex-wrap items-center gap-3 p-3">
                <span className="min-w-48 flex-1 text-body font-medium">
                  {ROTULO_AREA[area] ?? area}
                </span>
                <span className="text-dense text-muted-foreground">
                  {!disponivel ? (
                    <NaoExistiaNoPeriodo />
                  ) : qtd !== null ? (
                    `${qtd} ${qtd === 1 ? "registro" : "registros"}`
                  ) : (
                    "guardado"
                  )}
                </span>
                <code className="font-mono text-caption text-text-faint">
                  {(foto.checksumPorArea[area] ?? "").slice(0, 10)}
                </code>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-caption text-muted-foreground">{rotulo}</p>
      <p className="font-medium">{valor}</p>
    </div>
  );
}
