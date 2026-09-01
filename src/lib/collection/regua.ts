import type { MessageTone } from "@/lib/billing-message";

/**
 * A RÉGUA DE COBRANÇA, EM FORMA PURA (F3.9 · ref. 02 §4.3).
 *
 * "Régua: D-3, D0, D+3, D+7, D+15; nunca envia com promessa vigente, opt-out,
 * silêncio ou bloqueio manual; respeita dias úteis e horário."
 *
 * Módulo sem banco de propósito: a régua é a parte do sistema que FALA COM O
 * CLIENTE. Um erro aqui não aparece num relatório — aparece no WhatsApp de
 * quem está pagando em dia, e não tem como desfazer. Poder exercitar as
 * cinco etapas e os cinco silêncios em milissegundos, sem subir nada, é o que
 * permite testar cada combinação antes de a primeira mensagem existir.
 *
 * O QUE A RÉGUA NÃO FAZ NESTA FASE, e é decisão de 02 §4.3: ela não envia.
 * "Fase inicial gera TAREFA com mensagem pronta (envio em 1 toque, Modo
 * Fila)". Uma pessoa lê e manda. A fase automática (Outbox + WhatsApp) vem
 * depois — e é bom que venha depois: automatizar cobrança antes de ver
 * cinquenta mensagens geradas é como se descobre, com o cliente, que o tom
 * estava errado.
 */

export type EtapaDaRegua = "D-3" | "D0" | "D+3" | "D+7" | "D+15";

export type DefinicaoDaEtapa = {
  id: EtapaDaRegua;
  /** Dias em relação ao vencimento. Negativo é antes. */
  offset: number;
  titulo: string;
  /** O que a etapa está tentando conseguir — aparece na fila. */
  objetivo: string;
  tom: MessageTone;
};

/**
 * As cinco etapas. O TOM SOBE devagar de propósito: um lembrete três dias
 * antes do vencimento com tom de cobrança queima a relação com quem ia pagar
 * em dia — e é a maior parte da carteira.
 */
export const ETAPAS: DefinicaoDaEtapa[] = [
  { id: "D-3", offset: -3, titulo: "Lembrete antes do vencimento",
    objetivo: "Evitar o atraso por esquecimento — a maior causa isolada.",
    tom: "amigavel" },
  { id: "D0", offset: 0, titulo: "Vence hoje",
    objetivo: "Avisar no dia, com os dados de pagamento à mão.", tom: "padrao" },
  { id: "D+3", offset: 3, titulo: "Três dias de atraso",
    objetivo: "Primeiro contato de cobrança, ainda sem peso.", tom: "padrao" },
  { id: "D+7", offset: 7, titulo: "Uma semana de atraso",
    objetivo: "Pedir uma data. É aqui que a promessa aparece.", tom: "urgente" },
  { id: "D+15", offset: 15, titulo: "Quinze dias de atraso",
    objetivo: "Última tentativa antes de escalar a decisão.", tom: "ultima_tentativa" },
];

export const ETAPA_POR_ID = new Map(ETAPAS.map((e) => [e.id, e]));

export type MotivoDeSupressao =
  | "PAGA"
  | "PROMESSA"
  | "OPT_OUT"
  | "SILENCIO"
  | "BLOQUEIO"
  | "JA_ENVIADA"
  | "FREQUENCIA"
  | "FIM_DE_SEMANA"
  | "SEM_ETAPA_HOJE";

export const EXPLICACAO_DA_SUPRESSAO: Record<MotivoDeSupressao, string> = {
  PAGA: "A cobrança já foi quitada.",
  PROMESSA: "O cliente prometeu pagar e a data ainda não chegou.",
  OPT_OUT: "O cliente pediu para não receber cobrança automática.",
  SILENCIO: "Cobrança silenciada até uma data.",
  BLOQUEIO: "Cobrança bloqueada por decisão da casa.",
  JA_ENVIADA: "Esta etapa da régua já foi enviada para esta cobrança.",
  // Teto de frequência (F5.1 · decisão 19.17): UMA mensagem de cobrança por
  // cliente por dia. Quem deve três faturas é uma pessoa só no WhatsApp —
  // três mensagens no mesmo dia não cobram três vezes, irritam uma.
  FREQUENCIA: "O cliente já recebeu uma mensagem de cobrança hoje — o teto é uma por dia.",
  FIM_DE_SEMANA: "Hoje não é dia útil — a tarefa aparece na segunda.",
  SEM_ETAPA_HOJE: "Nenhuma etapa da régua cai hoje para esta cobrança.",
};

/** Só a data (meia-noite local), para comparar dias sem hora atrapalhar. */
export function soData(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function diasEntre(de: Date, ate: Date): number {
  return Math.round((soData(ate).getTime() - soData(de).getTime()) / 86_400_000);
}

/**
 * Dia útil = segunda a sexta.
 *
 * FERIADO NÃO É CONSIDERADO, e isto está escrito porque é uma limitação real:
 * não existe calendário de feriados no sistema, e inventar um (nacional? da
 * Bahia? bancário?) seria inventar regra. O efeito de errar é pequeno — uma
 * cobrança sai num feriado — e é preferível a uma tabela de feriados que
 * ninguém mantém e que um dia silencia a régua por uma semana.
 */
export function ehDiaUtil(d: Date): boolean {
  const dia = d.getDay();
  return dia >= 1 && dia <= 5;
}

/** Qual etapa cai HOJE para uma cobrança que vence em `dueDate`. */
export function etapaDoDia(hoje: Date, dueDate: Date): EtapaDaRegua | null {
  const delta = diasEntre(dueDate, hoje);
  return ETAPAS.find((e) => e.offset === delta)?.id ?? null;
}

export type EstadoDaCobranca = {
  dueDate: Date;
  quitada: boolean;
  /** Data prometida pelo cliente, quando há promessa em aberto. */
  promessaAte: Date | null;
  optOut: boolean;
  silencioAte: Date | null;
  bloqueio: string | null;
  /** Etapas já disparadas para esta cobrança. */
  etapasEnviadas: EtapaDaRegua[];
};

export type Avaliacao =
  | { gerar: true; etapa: DefinicaoDaEtapa }
  | { gerar: false; etapa: DefinicaoDaEtapa | null; motivo: MotivoDeSupressao; explicacao: string };

/**
 * A etapa PENDENTE mais avançada — o degrau em que esta cobrança está.
 *
 * A régua é RECUPERÁVEL de propósito: uma cobrança vencida há nove dias, cuja
 * fila ninguém trabalhou no fim de semana, precisa aparecer na segunda com a
 * etapa de D+7 — e não sumir porque "o dia dela passou". A fila do dia
 * seguinte a um feriado prolongado é justamente a que mais importa.
 *
 * Devolve a MAIS AVANÇADA pendente, nunca uma fila de cinco mensagens
 * atrasadas: disparar D-3, D0 e D+3 no mesmo dia seria a régua se
 * apresentando ao cliente como um sistema quebrado.
 *
 * E A RÉGUA SÓ ANDA PARA A FRENTE. Uma etapa abaixo da última já enviada
 * nunca volta a ser candidata — mandar o lembrete gentil de D+3 depois de já
 * ter mandado a cobrança urgente de D+7 desmonta a escalada inteira e ensina
 * o cliente que o "urgente" não era.
 */
export function etapaPendente(hoje: Date, c: EstadoDaCobranca): EtapaDaRegua | null {
  const delta = diasEntre(c.dueDate, hoje);
  const enviadas = ETAPAS.filter((e) => c.etapasEnviadas.includes(e.id));
  const piso = enviadas.length ? Math.max(...enviadas.map((e) => e.offset)) : -Infinity;
  const candidatas = ETAPAS.filter((e) => e.offset <= delta && e.offset > piso);
  return candidatas.length ? candidatas[candidatas.length - 1].id : null;
}

/**
 * A pergunta central: esta cobrança vira tarefa de cobrança hoje?
 *
 * A ORDEM DAS RECUSAS É A REGRA. Promessa vem antes de tudo o mais porque é o
 * silêncio que mais custa quebrar: cobrar quem acabou de combinar uma data é
 * o contato que faz o cliente parar de responder. Depois vêm as decisões
 * explícitas (bloqueio, opt-out, silêncio) e só então o calendário.
 */
export function avaliarRegua(hoje: Date, c: EstadoDaCobranca): Avaliacao {
  const etapaId = etapaPendente(hoje, c);
  const etapa = etapaId ? ETAPA_POR_ID.get(etapaId)! : null;
  const recusa = (motivo: MotivoDeSupressao): Avaliacao => ({
    gerar: false, etapa, motivo, explicacao: EXPLICACAO_DA_SUPRESSAO[motivo],
  });

  if (c.quitada) return recusa("PAGA");
  if (c.promessaAte && soData(c.promessaAte) >= soData(hoje)) return recusa("PROMESSA");
  if (c.bloqueio) return recusa("BLOQUEIO");
  if (c.optOut) return recusa("OPT_OUT");
  if (c.silencioAte && soData(c.silencioAte) >= soData(hoje)) return recusa("SILENCIO");
  if (!etapa) return recusa("SEM_ETAPA_HOJE");
  if (!ehDiaUtil(hoje)) return recusa("FIM_DE_SEMANA");

  return { gerar: true, etapa };
}
