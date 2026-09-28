/**
 * ENVIOS PROATIVOS POR CANAL (29/09/2026 — Fase 16 · bloco 2). Sem
 * dependência de servidor (a tela importa daqui).
 *
 * Quem recebe o quê é OPT-IN no vínculo do canal (MessagingIdentity):
 *  · relatórios diários — receiveMorningReport / receiveEveningReport;
 *  · avisos de evento — notificationEvents (lista de chaves abaixo).
 * Padrão: nada. Ninguém recebe só por estar vinculado.
 *
 * Os avisos estão PREPARADOS, não ligados: o catálogo, a preferência e a
 * consulta de destinatários (GET /api/v1/integrations/recipients) existem;
 * o entregador automático ainda não (o evento de negócio vai para o Outbox,
 * canal "integracao", e fica pendente até ele existir). `entregaAutomatica`
 * diz, por aviso, se já há quem entregue.
 */

export const FINALIDADES_DE_RELATORIO = ["morning_report", "evening_report"] as const;
export type FinalidadeDeRelatorio = (typeof FINALIDADES_DE_RELATORIO)[number];

export const ROTULO_DO_RELATORIO: Record<FinalidadeDeRelatorio, string> = {
  morning_report: "Relatório da manhã",
  evening_report: "Relatório da noite",
};

export const AVISOS_PROATIVOS = {
  "payment.received": { label: "Recebimento registrado", entregaAutomatica: false },
  "receivable.overdue": { label: "Cobrança vencida (inadimplência)", entregaAutomatica: false },
  "client.renewal.upcoming": { label: "Renovação chegando", entregaAutomatica: false },
  "expense.due_soon": { label: "Despesa perto do vencimento", entregaAutomatica: false },
} as const satisfies Record<string, { label: string; entregaAutomatica: boolean }>;

export type AvisoProativo = keyof typeof AVISOS_PROATIVOS;
export const CHAVES_DE_AVISO = Object.keys(AVISOS_PROATIVOS) as AvisoProativo[];

export const ehAviso = (v: string): v is AvisoProativo => v in AVISOS_PROATIVOS;
export const ehFinalidadeDeRelatorio = (v: string): v is FinalidadeDeRelatorio =>
  (FINALIDADES_DE_RELATORIO as readonly string[]).includes(v);

/**
 * Scope de leitura que a PESSOA precisa ter (pelo RBAC dela) para receber
 * cada envio. Sem ele, ela não entra na lista — mesmo marcada: um relatório
 * só com "sem acesso" é ruído.
 */
export const SCOPE_DA_FINALIDADE: Record<FinalidadeDeRelatorio | AvisoProativo, string> = {
  morning_report: "reports.read",
  evening_report: "reports.read",
  "payment.received": "receivables.read",
  "receivable.overdue": "receivables.read",
  "client.renewal.upcoming": "clients.read",
  "expense.due_soon": "expenses.read",
};

/** Finalidades aceitas na consulta de destinatários: relatórios + avisos. */
export const FINALIDADES = [...FINALIDADES_DE_RELATORIO, ...CHAVES_DE_AVISO] as const;
export type Finalidade = FinalidadeDeRelatorio | AvisoProativo;


/** Lista de avisos vinda de formulário/tela → só chaves conhecidas, sem repetição, na ordem do catálogo. */
export function normalizarAvisos(v: readonly string[] | null | undefined): AvisoProativo[] {
  const set = new Set((v ?? []).filter(ehAviso));
  return CHAVES_DE_AVISO.filter((k) => set.has(k));
}
