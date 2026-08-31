/**
 * Vocabulário da avaliação mensal (01 §4.13) — módulo NEUTRO.
 *
 * Vive separado do serviço de propósito: o serviço importa o Prisma, e a
 * grade é um componente de cliente. Importar a constante de lá arrastava
 * `async_hooks` para o navegador e quebrava a compilação. Aqui não há
 * nada além de dados.
 */
export const ESTABILIDADE = ["Estável", "Observação", "Crítico"] as const;
export const ADS_STATUS = ["Ativo", "Pausado", "Sem campanha"] as const;
export const RISCO = ["Baixo", "Médio", "Alto"] as const;
export const UPSELL = ["Sem oportunidade", "Mapeado", "Proposto"] as const;

export type LinhaAvaliacao = {
  relationshipId: string;
  clientId: string;
  clientName: string;
  gestores: string[];
  estabilidade: string | null;
  ads: string | null;
  risco: string | null;
  upsell: string | null;
  observacao: string | null;
  /** Já existe avaliação CONFIRMADA nesta competência? */
  confirmada: boolean;
  /** Os valores vieram do mês anterior (ainda não confirmados aqui)? */
  herdada: boolean;
  /** Sugestão do sistema, com o motivo — nunca imposta. */
  riscoSugerido: string | null;
  motivoSugestao: string | null;
  vencidas: number;
  saldoVencido: number;
};

export type SalvarAvaliacao = {
  relationshipId: string;
  estabilidade?: string | null;
  ads?: string | null;
  risco?: string | null;
  upsell?: string | null;
  observacao?: string | null;
};
