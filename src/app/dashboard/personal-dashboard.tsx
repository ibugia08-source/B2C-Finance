import Link from "next/link";
import { AlertTriangle, ClipboardList, RefreshCw, Rocket, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard, Sparkline } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { getViewer } from "@/lib/auth/viewer";
import { formatBRL } from "@/lib/format";
import { carregarPainelGestor, type AcaoPendente } from "@/lib/services/manager-panel";

/**
 * PAINEL DO GESTOR (F1.19 · ref. 02 §5.4).
 *
 * Substitui a antiga tela de boas-vindas, que só tinha um atalho para o
 * Assistente — um gestor abria o sistema e não via nada sobre a própria
 * carteira.
 *
 * 02 §5.4 é explícito no limite: "nenhum painel de papel mostra
 * resultado, folha ou caixa sem permissão de campo". Por isso aqui só
 * aparecem carteira, vencido e pendências operacionais. Quem tem
 * permissão financeira cai no painel executivo, não neste.
 */
export async function PersonalDashboard() {
  const viewer = await getViewer("/dashboard");
  const firstName = viewer.name?.split(" ")[0] ?? "";
  const p = await carregarPainelGestor(viewer.name ?? null);

  return (
    <div>
      <PageHeader
        title={firstName ? `Olá, ${firstName}` : "Minha carteira"}
        description={
          p.escopoTotal
            ? "Mostrando a carteira inteira — não encontrei você na lista de colaboradores para filtrar só os seus clientes."
            : `Sua carteira: ${p.ativos} cliente(s) sob sua responsabilidade.`
        }
      />

      {/* Decidir — sem resultado, folha ou caixa (02 §5.4) */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Clientes ativos"
          value={String(p.ativos)}
          hint={p.escopoTotal ? "toda a carteira" : "sob sua responsabilidade"}
          href="/clientes"
        />
        <MetricCard
          title="Críticos"
          value={String(p.criticos)}
          hint={`${p.emObservacao} em observação`}
          tone={p.criticos > 0 ? "neg" : "pos"}
          help="Clientes marcados como Crítico na estabilidade ou Alto no risco, na avaliação deste mês."
          href="/avaliacoes"
        />
        <MetricCard
          title="Vencido na carteira"
          value={formatBRL(p.vencidoValor)}
          basis="competencia"
          hint={`${p.vencidoClientes} cliente(s)`}
          tone={p.vencidoValor > 0 ? "warn" : "pos"}
          href="/inadimplencia"
        />
        <MetricCard
          title="Renovam este mês"
          value={String(p.renovacoesDoMes)}
          tone={p.renovacoesDoMes > 0 ? "warn" : "default"}
          href="/renovacoes"
        />
      </div>

      {/* Entender — uma linha só, que é o teto útil neste painel */}
      <Card className="mb-4">
        <CardContent className="p-5">
          <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
            A carteira cresceu nos últimos 6 meses?
          </p>
          <div className="mt-3 flex items-end gap-4">
            <div className="min-w-0 flex-1 text-primary">
              <Sparkline points={p.evolucao.map((e) => e.ativos)} height={44} />
            </div>
            <p className="stat-number shrink-0 text-value">{p.ativos}</p>
          </div>
          <div className="mt-1 flex justify-between text-caption text-muted-foreground">
            {p.evolucao.map((e) => (
              <span key={e.label}>{e.label}</span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Agir */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ListaAcoes
          icone={ClipboardList}
          titulo="Avaliações pendentes"
          vazio="Todas as avaliações deste mês confirmadas."
          itens={p.avaliacoesPendentes}
          acao={{ href: "/avaliacoes", label: "Abrir a grade" }}
        />
        <ListaAcoes
          icone={Rocket}
          titulo="Onboarding fora do prazo"
          vazio="Nenhuma tarefa de implantação atrasada."
          itens={p.onboardingVencido}
        />
        <ListaAcoes
          icone={RefreshCw}
          titulo="Renovações sem leitura"
          vazio="Nenhuma renovação deste mês sem avaliação."
          itens={p.renovacoesSemNegociacao}
          acao={{ href: "/renovacoes", label: "Ver renovações" }}
        />
      </div>

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="flex items-center gap-2 text-body text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Precisa de apoio no dia a dia? O Assistente conhece a carteira.
          </p>
          <Button asChild variant="outline">
            <Link href="/assistente">Abrir o Assistente</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ListaAcoes({
  icone: Icone,
  titulo,
  itens,
  vazio,
  acao,
}: {
  icone: typeof AlertTriangle;
  titulo: string;
  itens: AcaoPendente[];
  vazio: string;
  acao?: { href: string; label: string };
}) {
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col p-4">
        <p className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-muted-foreground">
          <Icone className="h-3.5 w-3.5" aria-hidden />
          {titulo}
          {itens.length > 0 && (
            <span className="ml-auto rounded-pill bg-warning-soft px-2 py-0.5 text-caption text-foreground">
              {itens.length}
            </span>
          )}
        </p>

        {itens.length === 0 ? (
          <EmptyState className="py-6" title={vazio} />
        ) : (
          <ul className="mt-2 flex-1 space-y-1">
            {itens.map((i) => (
              <li key={`${titulo}-${i.clientId}`} className="text-body">
                <Link href={i.href} className="group flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate group-hover:underline">{i.clientName}</span>
                  <span className="shrink-0 text-caption text-muted-foreground">{i.motivo}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {acao && itens.length > 0 && (
          <Button asChild variant="outline" size="sm" className="mt-3 w-full">
            <Link href={acao.href}>{acao.label}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
