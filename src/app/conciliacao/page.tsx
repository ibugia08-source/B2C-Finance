import { PageHeader } from "@/components/page-header";
import { MonthNav } from "@/components/month-nav";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { Landmark } from "lucide-react";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { formatBRL, monthLabel } from "@/lib/format";
import {
  linhasDaConta, resumoDaConciliacao, MINIMO_CONCILIADO,
} from "@/lib/services/reconciliation";
import { PainelDeConciliacao } from "./painel";
import { competenciaDaUrl } from "@/lib/competence";

/**
 * CONCILIAÇÃO BANCÁRIA (F3.5 · ref. 01 §4.7; 02 §4.4).
 *
 * A tela responde: o que o banco diz que aconteceu e o sistema não sabe?
 *
 * DECIDIDO 19.37: conta COM movimento se concilia até o dia 5; conta PARADA
 * só tem o saldo conferido. Por isso a lista separa as duas — cobrar
 * conciliação de conta que não movimentou gasta a atenção que a conta ativa
 * precisa.
 */
export const dynamic = "force-dynamic";

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams?: { mes?: string; conta?: string };
}) {
  const viewer = await requirePagePermission("conciliacao.visualizar");

  const { competence, ano, mes } = competenciaDaUrl(searchParams?.mes);

  const resumo = await resumoDaConciliacao(competence);
  const contasRelevantes = resumo.contas.filter((c) => c.situacao !== "PARADA");
  const contaAtual =
    resumo.contas.find((c) => c.accountId === searchParams?.conta) ??
    contasRelevantes[0] ??
    resumo.contas[0] ??
    null;

  const [linhas, contas] = await Promise.all([
    contaAtual ? linhasDaConta(contaAtual.accountId, competence) : Promise.resolve([]),
    prisma.account.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const pendentes = resumo.contas.reduce((s, c) => s + c.pendentes, 0);

  return (
    <div>
      <PageHeader
        title="Conciliação bancária"
        description={`${monthLabel(new Date(ano, mes - 1, 1))} — o que o banco diz, conferido com o que o sistema sabe`}
        actions={<MonthNav month={mes} year={ano} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          title="Conciliado no mês"
          value={resumo.percentualGeral === null ? null : `${resumo.percentualGeral}%`}
          nullReason="Nenhum extrato importado neste mês"
          tone={
            resumo.percentualGeral === null
              ? "default"
              : resumo.percentualGeral >= MINIMO_CONCILIADO
                ? "positive"
                : "warning"
          }
          hint={`Mínimo por conta: ${MINIMO_CONCILIADO}%`}
        />
        <MetricCard
          title="Linhas pendentes"
          value={String(pendentes)}
          tone={pendentes > 0 ? "warning" : "positive"}
          hint="Sem par, parciais ou em revisão"
        />
        <MetricCard
          title="Contas a resolver"
          value={String(resumo.pendentes)}
          tone={resumo.pendentes > 0 ? "warning" : "positive"}
          hint="Com movimento e fora do mínimo"
        />
        <MetricCard
          title="Contas paradas"
          value={String(resumo.contas.filter((c) => c.situacao === "PARADA").length)}
          hint="Sem movimento: só confirmar saldo"
          help="Decisão da direção: conta com movimento se concilia até o dia 5; conta parada só tem o saldo conferido."
        />
      </div>

      {resumo.contas.length === 0 ? (
        <div>
          <EmptyState
            icon={Landmark}
            title="Nenhuma conta conectada ainda"
            description="A conta nasce da primeira importação de extrato (abaixo) ou da conexão bancária — não existe cadastro manual de conta."
          />
          {can(viewer, "conciliacao.conciliar") ? (
            <div className="mt-4">
              <PainelDeConciliacao
                competence={competence}
                resumo={resumo}
                contas={contas}
                contaAtual={null}
                linhas={[]}
                podeConciliar
              />
            </div>
          ) : null}
        </div>
      ) : (
        <PainelDeConciliacao
          competence={competence}
          resumo={resumo}
          contas={contas}
          contaAtual={contaAtual?.accountId ?? null}
          linhas={linhas}
          podeConciliar={can(viewer, "conciliacao.conciliar")}
        />
      )}

      {contaAtual && contaAtual.saldoDoBanco !== null ? (
        <p className="mt-3 text-dense text-muted-foreground">
          Saldo do banco no último extrato: {formatBRL(contaAtual.saldoDoBanco)} ·
          saldo do sistema: {formatBRL(contaAtual.saldoDoSistema)}
          {Math.abs(contaAtual.saldoDoBanco - contaAtual.saldoDoSistema) > 0.005 ? (
            <span className="text-warning">
              {" "}
              — diferença de {formatBRL(contaAtual.saldoDoBanco - contaAtual.saldoDoSistema)}.
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
