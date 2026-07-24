import type { TemplateVariable } from "./template";

/**
 * Pré-preenchimento de variáveis de modelo de contrato — compartilhado entre
 * o wizard interno (/contratos/[id]/gerar) e o formulário público (/f/{token}).
 * Puro (sem servidor): usável em client components e em pages de servidor.
 */

export type PrefillClient = {
  name: string;
  legalName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  legalRepresentative: string | null;
  city: string | null;
  state: string | null;
  segment: string | null;
  paymentDay: number | null;
};

export type PrefillTemplateMeta = {
  defaultDueDay: number | null;
  durationMonths: number | null;
  monthlyAmount: number | null;
  totalAmount: number | null;
};

function fmtMoney(n: number | null): string {
  return n != null && n > 0
    ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
}

function todayBR(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Valor sugerido para uma variável a partir do cliente + metadados do modelo. */
export function prefillValue(
  v: TemplateVariable,
  client: PrefillClient | null,
  t: PrefillTemplateMeta
): string {
  if (!v.clientField) return "";
  const clientMap: Record<string, string | null | undefined> = client
    ? {
        "client.name": client.name,
        "client.legalName": client.legalName,
        "client.document": client.document,
        "client.email": client.email,
        "client.phone": client.phone,
        "client.address": client.address,
        "client.legalRepresentative": client.legalRepresentative,
        "client.city": client.city,
        "client.state": client.state,
        "client.segment": client.segment,
      }
    : {};
  const contractMap: Record<string, string> = {
    "contract.startDate": todayBR(),
    "contract.dueDay": String(t.defaultDueDay ?? client?.paymentDay ?? ""),
    "contract.monthlyAmount": fmtMoney(t.monthlyAmount),
    "contract.totalAmount": fmtMoney(t.totalAmount),
    "contract.durationMonths": t.durationMonths != null ? String(t.durationMonths) : "",
  };
  return clientMap[v.clientField] ?? contractMap[v.clientField] ?? "";
}

/** Props de input adequadas ao tipo da variável (placeholder/teclado). */
export function variableInputProps(type: TemplateVariable["type"]) {
  switch (type) {
    case "date":
      return { placeholder: "dd/mm/aaaa", inputMode: "numeric" as const };
    case "money":
      return { placeholder: "0,00", inputMode: "decimal" as const };
    case "number":
      return { inputMode: "numeric" as const };
    case "email":
      return { type: "email", placeholder: "email@empresa.com" };
    case "phone":
      return { type: "tel", placeholder: "(71) 9…" };
    case "document":
      return { placeholder: "CNPJ/CPF" };
    default:
      return {};
  }
}
