/**
 * O VOCABULÁRIO DAS METAS (F4.5 · ref. 02 §5.4).
 *
 * Módulo NEUTRO — sem Prisma, sem React. É a TERCEIRA vez neste projeto que
 * uma tela de cliente importa constante de um módulo de serviço e arrasta o
 * Prisma (e o `async_hooks` do contexto de dono) para dentro do pacote do
 * navegador. Vale a regra explícita: **constante que a tela usa mora em
 * `lib/commercial/*` ou `lib/*` neutro; serviço só exporta função e tipo.**
 *
 * Tipo atravessa a fronteira servidor→cliente sem reclamar; valor não. Nos
 * dois primeiros casos (ícones do setup, campos da atividade) só o smoke test
 * autenticado pegou. Neste, o build pegou — a diferença é sorte de como o
 * webpack resolve o grafo, não uma proteção em que dá para confiar.
 */

export const ESCOPOS = ["AGENCY", "SDR", "CLOSER", "GESTOR"] as const;
export type EscopoDaMeta = (typeof ESCOPOS)[number];

export const ROTULO_DO_ESCOPO: Record<EscopoDaMeta, string> = {
  AGENCY: "Agência",
  SDR: "SDR",
  CLOSER: "Closer",
  GESTOR: "Gestor",
};

/**
 * Cada métrica declara em QUAIS escopos faz sentido. Oferecer "ligações" para
 * um closer criaria meta que painel nenhum lê — e meta que ninguém vê é pior
 * que meta nenhuma, porque parece que existe controle.
 */
export const METRICAS_DE_META = [
  { id: "ligacoes", rotulo: "Ligações", escopos: ["SDR"], unidade: "quantidade" },
  { id: "abordagens", rotulo: "Abordagens", escopos: ["SDR"], unidade: "quantidade" },
  { id: "agendamentos", rotulo: "Agendamentos", escopos: ["SDR"], unidade: "quantidade" },
  { id: "reunioes", rotulo: "Reuniões realizadas", escopos: ["SDR", "CLOSER"], unidade: "quantidade" },
  { id: "propostas", rotulo: "Propostas enviadas", escopos: ["SDR", "CLOSER"], unidade: "quantidade" },
  { id: "vendas", rotulo: "Vendas fechadas", escopos: ["CLOSER", "AGENCY"], unidade: "quantidade" },
  { id: "valor", rotulo: "Valor vendido", escopos: ["CLOSER", "AGENCY", "GESTOR"], unidade: "dinheiro" },
] as const;

export type MetricaDeMeta = (typeof METRICAS_DE_META)[number]["id"];

export type MetaCadastrada = {
  id: string;
  competence: string;
  scopeType: EscopoDaMeta;
  scopeId: string;
  metric: MetricaDeMeta;
  rotuloDaMetrica: string;
  target: number;
  unidade: "quantidade" | "dinheiro";
};
