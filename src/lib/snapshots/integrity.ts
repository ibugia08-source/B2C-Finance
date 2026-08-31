import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { ledgerHealth } from "@/lib/accounting/health";
import { montarAreas } from "./engine";
import { checksumByArea } from "./serialize";

/**
 * JOB DE INTEGRIDADE (F2.8 · ref. 01 §5.4).
 *
 * "Valida balanço do ledger, recalcula totais até sourceCutoffAt, compara
 * checksums, alerta divergências."
 *
 * As três perguntas, e por que são três:
 *
 *   1. O RAZÃO FECHA? Débito igual a crédito. Se não fecha, o DRE está errado
 *      e ninguém saberia até alguém somar à mão.
 *   2. A FOTOGRAFIA FOI ADULTERADA? O checksum recalculado do próprio
 *      conteúdo gravado tem de bater com o gravado. Pega escrita por fora do
 *      sistema.
 *   3. O MÊS MUDOU DEPOIS DE FECHADO? Recalcula lendo os fatos até o corte e
 *      compara. Pega fato inserido com data retroativa depois do fechamento.
 *
 * A terceira é a única que exige o `sourceCutoffAt`, e é a que justifica ele
 * existir. Sem o corte, comparar o passado congelado com o presente vivo
 * acusaria divergência sempre.
 *
 * O QUE ISTO PEGA E O QUE NÃO PEGA, dito com precisão:
 *
 *   PEGA linha que existia no fechamento e foi ALTERADA depois — ela continua
 *   entrando no recálculo (foi criada antes do corte) e entra com o valor de
 *   agora, então o checksum não fecha. É o caso que interessa: mexer no
 *   passado sem reabrir a competência.
 *
 *   NÃO PEGA — e não deve pegar — fato CRIADO depois do corte. Ele não faz
 *   parte do mundo daquela fotografia. 01 §5.6 é explícito: o pagamento que
 *   entra em outubro de uma cobrança de agosto é normal, e a fotografia de
 *   agosto continua mostrando vencido. Acusar isso como divergência
 *   reprovaria o job toda vez que a cobrança fizesse o trabalho dela.
 *
 * O ÁREA `indicadores` FICA DE FORA da comparação, e é decisão, não descuido:
 * ele vem do motor de métricas, que não sabe ler "como estava até o corte" —
 * e várias métricas dependem de HOJE (vencido é dueDate < hoje). Recalculado
 * amanhã, ele dá outro número mesmo sem nada ter mudado; incluí-lo faria o
 * job reprovar todo dia e ser desligado na primeira semana.
 */

/**
 * Áreas que NÃO entram na comparação de "mudou desde o fechamento".
 * A integridade delas é conferida do outro lado (checksum do conteúdo
 * gravado), que pega adulteração da linha.
 */
const FORA_DO_RECALCULO = new Set(["indicadores"]);

export type DivergenciaFotografia = {
  competence: string;
  versao: number;
  /** Áreas cujo conteúdo GRAVADO não bate com o checksum gravado. */
  adulteradas: string[];
  /** Áreas que mudaram desde o fechamento (fato novo com data retroativa). */
  mudaramDesdeOFechamento: string[];
};

export type RelatorioIntegridade = {
  /** Data a partir da qual cobertura do razão é exigida (null = desde sempre). */
  corteDoRazao: Date | null;
  razaoLigado: boolean;
  razaoBalanceado: boolean;
  lancamentosDesbalanceados: number;
  pagamentosSemLancamento: number;
  fotografiasConferidas: number;
  divergencias: DivergenciaFotografia[];
  /** Há algo que exija ação humana? */
  ok: boolean;
};

export async function conferirIntegridade(
  opts: { competencias?: string[]; desde?: Date | null } = {}
): Promise<RelatorioIntegridade> {
  const workspaceId = await currentWorkspaceId();
  // O CORTE DO RAZÃO importa: antes de ele ser ligado, pagamento sem
  // lançamento é o esperado, não defeito — aquele período entra por um
  // lançamento de abertura só (01 §3.11). Cobrar cobertura desde sempre faria
  // o job reprovar para sempre, e um job que reprova sempre é um job
  // desligado.
  const saude = await ledgerHealth(workspaceId, { desde: opts.desde ?? null });

  const fotos = await runWithoutScope(async () =>
    prisma.snapshot.findMany({
      where: {
        workspaceId,
        kind: "NATIVE",
        ...(opts.competencias?.length ? { competence: { in: opts.competencias } } : {}),
      },
      orderBy: [{ competence: "asc" }, { version: "asc" }],
    })
  );

  const divergencias: DivergenciaFotografia[] = [];

  for (const f of fotos) {
    const gravadas = (f.areas ?? {}) as Record<string, unknown>;
    const gravadoPorArea = (f.checksumByArea ?? {}) as Record<string, string>;

    // (2) A linha foi adulterada por fora?
    const doConteudo = checksumByArea(gravadas);
    const adulteradas = Object.keys(doConteudo.porArea).filter(
      (a) => gravadoPorArea[a] && gravadoPorArea[a] !== doConteudo.porArea[a]
    );

    // (3) O mês mudou depois de fechado?
    const recalculadas = await montarAreas(f.competence, { ate: f.sourceCutoffAt });
    const doRecalculo = checksumByArea(recalculadas);
    const mudaram = Object.keys(doRecalculo.porArea).filter(
      (a) =>
        !FORA_DO_RECALCULO.has(a) &&
        gravadoPorArea[a] &&
        gravadoPorArea[a] !== doRecalculo.porArea[a]
    );

    if (adulteradas.length || mudaram.length) {
      divergencias.push({
        competence: f.competence,
        versao: f.version,
        adulteradas,
        mudaramDesdeOFechamento: mudaram,
      });
    }
  }

  const razaoOk = !saude.enabled || (saude.balanceOk && saude.pagamentosSemLancamento === 0);

  return {
    corteDoRazao: saude.desde,
    razaoLigado: saude.enabled,
    razaoBalanceado: saude.balanceOk,
    lancamentosDesbalanceados: saude.desbalanceadas.length,
    pagamentosSemLancamento: saude.pagamentosSemLancamento,
    fotografiasConferidas: fotos.length,
    divergencias,
    ok: razaoOk && divergencias.length === 0,
  };
}
