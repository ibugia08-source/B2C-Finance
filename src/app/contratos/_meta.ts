/**
 * Rótulos do módulo de contratos DOCUMENTAIS (modelos DOCX + gerados).
 * Os rótulos do acordo comercial/financeiro estão em src/app/acordos/_meta.ts.
 */

export const COMMERCIAL_TYPE_LABEL: Record<string, string> = {
  MRR: "MRR (recorrente)",
  TCV: "TCV (valor total)",
  ONE_TIME: "Avulso",
  CUSTOM: "Personalizado",
};

export const BILLING_MODEL_LABEL: Record<string, string> = {
  MONTHLY: "Mensal",
  UPFRONT: "À vista",
  INSTALLMENTS: "Parcelado",
  CUSTOM: "Personalizado",
};

export const DURATION_TYPE_LABEL: Record<string, string> = {
  MONTHLY: "Mensal",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
  CUSTOM: "Personalizado",
};

export const TEMPLATE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativo",
  ARCHIVED: "Arquivado",
};

export function templateStatusVariant(s: string): "success" | "secondary" | "outline" {
  if (s === "ACTIVE") return "success";
  if (s === "DRAFT") return "secondary";
  return "outline";
}

export const GENERATED_STATUS_LABEL: Record<string, string> = {
  GENERATED: "Gerado",
  SENT: "Enviado",
  SIGNED: "Assinado",
  CANCELED: "Cancelado",
  ARCHIVED: "Arquivado",
};

export function generatedStatusVariant(
  s: string
): "success" | "secondary" | "warning" | "destructive" | "outline" {
  if (s === "SIGNED") return "success";
  if (s === "SENT") return "warning";
  if (s === "CANCELED") return "destructive";
  if (s === "ARCHIVED") return "outline";
  return "secondary";
}

export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  CONTRACT: "Contrato",
  PROPOSAL: "Proposta",
  RECEIPT: "Comprovante",
  BRIEFING: "Briefing",
  LEGAL_DOCUMENT: "Documento jurídico",
  OTHER: "Outro",
};

/** Opções de origem do pré-preenchimento (editor de variáveis). */
export const CLIENT_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— preencher manualmente —" },
  { value: "client.name", label: "Cliente · Nome" },
  { value: "client.legalName", label: "Cliente · Razão social" },
  { value: "client.document", label: "Cliente · CNPJ/CPF" },
  { value: "client.email", label: "Cliente · E-mail" },
  { value: "client.phone", label: "Cliente · Telefone" },
  { value: "client.address", label: "Cliente · Endereço" },
  { value: "client.legalRepresentative", label: "Cliente · Representante legal" },
  { value: "client.city", label: "Cliente · Cidade" },
  { value: "client.state", label: "Cliente · UF" },
  { value: "client.segment", label: "Cliente · Segmento" },
  { value: "contract.startDate", label: "Contrato · Data de início" },
  { value: "contract.dueDay", label: "Contrato · Dia de vencimento" },
  { value: "contract.monthlyAmount", label: "Contrato · Valor mensal" },
  { value: "contract.totalAmount", label: "Contrato · Valor total" },
  { value: "contract.durationMonths", label: "Contrato · Prazo (meses)" },
];

export const NOTE_TYPE_LABEL: Record<string, string> = {
  observacao: "Observação",
  comercial: "Histórico comercial",
  negociacao: "Negociação",
  atendimento: "Atendimento",
  alerta: "Alerta interno",
};
