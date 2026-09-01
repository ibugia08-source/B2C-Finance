import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CheckCheck } from "lucide-react";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { filaDeCobranca } from "@/lib/services/collection-tasks";
import { linhasDaConta, resumoDaConciliacao } from "@/lib/services/reconciliation";
import { filaDeRevisao } from "@/lib/services/import-review";
import { urlConfigurada, segredoConfigurado } from "@/lib/integrations/avancecrm";
import { emissaoConfigurada } from "@/lib/integrations/gateway";
import { ModoFila, type Trilha } from "./modo-fila";

/**
 * MODO FILA (F3.9 · ref. 02 §7.5 gabarito 3, §7.7).
 *
 * "Um item em foco + contexto ao lado, ações por tecla, progresso '12 de 38',
 * pular sem culpa."
 *
 * TRÊS trilhas, não quatro: a coluna "aprovações" que a spec previa deixou de
 * existir com a decisão 19.35/19.36 — não há tetos nem fila de aprovação, e
 * uma trilha permanentemente vazia ensinaria a ignorar a tela.
 *
 * O motivo de a fila existir separada das telas de trabalho: quem processa 38
 * cobranças não quer navegar, filtrar nem escolher. Quer um item, uma decisão
 * e a tecla seguinte.
 */
export const dynamic = "force-dynamic";

const TRILHAS: Trilha[] = ["cobranca", "conciliacao", "importacao"];

async function FilaPageInner({
  searchParams,
}: {
  searchParams?: { trilha?: string };
}) {
  const viewer = await requirePagePermission("recebimentos.visualizar");
  const trilha = (TRILHAS as string[]).includes(searchParams?.trilha ?? "")
    ? (searchParams!.trilha as Trilha)
    : "cobranca";

  const podeCobrar = can(viewer, "recebimentos.gerar_cobranca");
  const podeConciliar = can(viewer, "conciliacao.conciliar");
  const podeRevisar = can(viewer, "importacoes.importar");

  const hoje = new Date();
  const competence = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

  const [cobranca, conciliacao, revisao] = await Promise.all([
    filaDeCobranca(hoje),
    can(viewer, "conciliacao.visualizar")
      ? (async () => {
          const resumo = await resumoDaConciliacao(competence);
          const contas = resumo.contas.filter((c) => c.pendentes > 0);
          const linhas = await Promise.all(
            contas.slice(0, 5).map(async (c) => ({
              conta: c.nome,
              linhas: (await linhasDaConta(c.accountId, competence)).filter(
                (l) => l.state === "UNMATCHED" || l.state === "PARTIAL"
              ),
            }))
          );
          return linhas.flatMap((x) =>
            x.linhas.map((l) => ({
              id: l.id, conta: x.conta, descricao: l.description,
              valor: l.amount, data: l.postedAt, estado: l.state,
            }))
          );
        })()
      : Promise.resolve([]),
    podeRevisar ? filaDeRevisao(100) : Promise.resolve([]),
  ]);

  const vazia =
    cobranca.tarefas.length === 0 && conciliacao.length === 0 && revisao.length === 0;

  return (
    <div>
      <PageHeader
        title="Modo Fila"
        description="Um item por vez, decisão por tecla. Pressione ? para ver os atalhos."
      />

      {vazia && cobranca.suprimidas.length === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title="Nada na fila hoje"
          description="Nenhuma cobrança no degrau da régua, nenhuma linha de extrato sem par e nenhuma linha de importação para revisar."
        />
      ) : (
        <ModoFila
          trilhaInicial={trilha}
          cobranca={cobranca}
          conciliacao={conciliacao}
          revisao={revisao}
          podeCobrar={podeCobrar}
          envioIntegrado={!!urlConfigurada() && !!segredoConfigurado()}
          gatewayAtivo={emissaoConfigurada()}
          podeConciliar={podeConciliar}
          podeRevisar={podeRevisar}
        />
      )}
    </div>
  );
}

// T7 — o p95 desta tela é medido contra o orçamento de 03 §4.7.
export default async function FilaPage(
  ...args: Parameters<typeof FilaPageInner>
) {
  const { medir } = await import("@/lib/observability");
  return medir("page:fila", () => FilaPageInner(...args));
}
