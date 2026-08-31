/**
 * TEMPLATE PADRÃO DE ONBOARDING (F1.18 · ref. 01 §4.11) — módulo NEUTRO.
 *
 * A lista é a da spec, na ordem em que ela a escreve. Os prazos seguem a
 * regra D+7 / D+30 / D+90 contados da ATIVAÇÃO da relação.
 *
 * OBRIGATÓRIA x OPCIONAL não é detalhe burocrático: 01 §4.11 diz que
 * "sair de Onboarding exige obrigatórias completas ou exceção com
 * motivo". É esse campo que decide se o cliente pode ser considerado
 * implantado — e é por isso que o contrato, os acessos e a primeira
 * campanha no ar são obrigatórios, enquanto os formulários de canal que
 * o cliente pode não usar são opcionais.
 *
 * Sem imports de servidor: usado pela tela e pelo serviço.
 */
export type TarefaTemplate = {
  key: string;
  title: string;
  description?: string;
  offsetDays: number;
  required: boolean;
};

export const ONBOARDING_TEMPLATE: TarefaTemplate[] = [
  { key: "contrato", title: "Contrato assinado", offsetDays: 7, required: true,
    description: "Sem contrato o trabalho começa, mas a cobrança fica sem lastro." },
  { key: "form_google", title: "Formulário Google Ads", offsetDays: 7, required: false },
  { key: "form_meta", title: "Formulário Meta Ads", offsetDays: 7, required: false },
  { key: "gmn", title: "Google Meu Negócio", offsetDays: 30, required: false },
  { key: "social", title: "Social Media", offsetDays: 30, required: false },
  { key: "ctwa", title: "CTWA (clique para WhatsApp)", offsetDays: 30, required: false },
  { key: "crm", title: "Acesso ao CRM", offsetDays: 7, required: true },
  { key: "kickoff", title: "Reunião de kickoff", offsetDays: 7, required: true },
  { key: "campanha", title: "Primeira campanha no ar", offsetDays: 30, required: true },
  { key: "resultado", title: "Primeira reunião de resultado", offsetDays: 90, required: true },
];

export const TAREFAS_OBRIGATORIAS = ONBOARDING_TEMPLATE.filter((t) => t.required).length;

export type TarefaOnboarding = {
  id: string;
  title: string;
  description: string | null;
  templateKey: string | null;
  offsetDays: number | null;
  dueAt: string | null;
  doneAt: string | null;
  doneBy: string | null;
  required: boolean;
  atrasada: boolean;
};

export type QuadroOnboarding = {
  relationshipId: string;
  status: string;
  iniciadoEm: string | null;
  tarefas: TarefaOnboarding[];
  concluidas: number;
  total: number;
  obrigatoriasPendentes: number;
};
