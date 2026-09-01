import type { OpportunityStage } from "@prisma/client";

/**
 * AS ETAPAS DO FUNIL (F4.2 · ref. 01 §4.6; 02 §4).
 *
 * Módulo NEUTRO — sem Prisma e sem React —, consumido pela tela, pelo serviço
 * e pelos testes. As etapas precisam ser as MESMAS nos três lugares: um funil
 * cujo nome de coluna mora numa tela e cuja regra mora noutra é como o
 * relatório de conversão passa a discordar do quadro.
 */

export type EtapaDoFunil = OpportunityStage;

export type DefinicaoDeEtapa = {
  id: EtapaDoFunil;
  titulo: string;
  /** O que precisa acontecer para a oportunidade sair desta etapa. */
  saidaDaEtapa: string;
  /** Etapa terminal não tem coluna no quadro — vira desfecho. */
  terminal: boolean;
};

export const ETAPAS_DO_FUNIL: DefinicaoDeEtapa[] = [
  { id: "NOVA", titulo: "Nova", saidaDaEtapa: "Falar com o contato e entender o caso.", terminal: false },
  { id: "QUALIFICACAO", titulo: "Qualificação", saidaDaEtapa: "Confirmar que faz sentido e agendar a reunião.", terminal: false },
  { id: "REUNIAO", titulo: "Reunião", saidaDaEtapa: "Realizar a reunião e levantar o escopo.", terminal: false },
  { id: "PROPOSTA", titulo: "Proposta", saidaDaEtapa: "Enviar a proposta com valor e prazo.", terminal: false },
  { id: "NEGOCIACAO", titulo: "Negociação", saidaDaEtapa: "Fechar ou registrar o motivo da perda.", terminal: false },
  { id: "GANHA", titulo: "Ganha", saidaDaEtapa: "Entregar para a operação.", terminal: true },
  { id: "PERDIDA", titulo: "Perdida", saidaDaEtapa: "—", terminal: true },
];

export const COLUNAS_DO_QUADRO = ETAPAS_DO_FUNIL.filter((e) => !e.terminal);
export const ETAPA_POR_ID = new Map(ETAPAS_DO_FUNIL.map((e) => [e.id, e]));

/** Ordem numérica, para saber se a oportunidade AVANÇOU ou voltou. */
export const ORDEM_DA_ETAPA: Record<EtapaDoFunil, number> = {
  NOVA: 0, QUALIFICACAO: 1, REUNIAO: 2, PROPOSTA: 3, NEGOCIACAO: 4,
  GANHA: 5, PERDIDA: 5,
};

/**
 * Dias parados que tornam a oportunidade "esquecida".
 *
 * Sete, porque é o que 02 §4.6 usa na rotina semanal — o mesmo número nos
 * dois lugares, senão o quadro e a rotina discordam sobre o que está parado.
 */
export const DIAS_PARA_PARADA = 7;

/** Motivo de perda em branco não existe (o banco também recusa). */
export function exigeMotivo(etapa: EtapaDoFunil): boolean {
  return etapa === "PERDIDA";
}
