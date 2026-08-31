/**
 * MATRIZ CANÔNICA DE EVENTOS CONTÁBEIS (01 §3.10) — fonte única.
 *
 * Cada linha diz, para um FATO de domínio, qual conta é debitada, qual é
 * creditada e se a operação reconhece resultado. Nenhuma tela decide isso;
 * o AccountingEngine aplica a regra ATIVA e VERSIONADA.
 *
 * Regra de ouro por trás da tabela (01 §2.6): reconhecimento não é pagamento.
 * Pagar dívida já reconhecida MOVE ativo/passivo — não cria despesa nova.
 * É isso que impede empréstimo, fatura de cartão e transferência de aparecerem
 * duas vezes no resultado.
 *
 * Contas "de contexto" (o banco da conta usada, a receita conforme a
 * modalidade) são refinadas em execução; aqui fica o código padrão.
 */

export type PostingEventType =
  | "REVENUE_RECOGNIZED"
  | "CUSTOMER_PAYMENT_RECEIVED"
  | "EXTRA_REVENUE_RECEIVED"
  | "EXPENSE_RECOGNIZED_ON_CREDIT"
  | "EXPENSE_PAID_CASH"
  | "PAYABLE_SETTLED"
  | "CARD_PURCHASE"
  | "CARD_INVOICE_PAID"
  | "LOAN_RECEIVED"
  | "LOAN_PRINCIPAL_PAID"
  | "INTEREST_EXPENSE"
  | "ACCOUNT_TRANSFER"
  | "TAX_PROVISIONED"
  | "TAX_PAID"
  | "CUSTOMER_REFUND"
  | "RECEIVABLE_WRITE_OFF"
  | "REVERSAL";

export type PostingRuleSpec = {
  eventType: PostingEventType;
  name: string;
  description: string;
  /** Código do plano de contas (03 §2.2). */
  debitAccountCode: string;
  creditAccountCode: string;
  /** Reconhece resultado (entra na DRE)? */
  affectsPnl: boolean;
  /** Implementado no motor nesta fase? (F0.8 entrega os cinco primeiros.) */
  implemented: boolean;
};

export const POSTING_RULES: PostingRuleSpec[] = [
  {
    eventType: "REVENUE_RECOGNIZED",
    name: "Receita reconhecida",
    description:
      "A competência passa a ter direito de receber: nasce o recebível e a receita operacional.",
    debitAccountCode: "1.3",
    creditAccountCode: "4.1",
    affectsPnl: true,
    implemented: true,
  },
  {
    eventType: "CUSTOMER_PAYMENT_RECEIVED",
    name: "Recebimento de cliente",
    description:
      "O dinheiro entra e o recebível baixa. NÃO reconhece receita de novo — ela já foi reconhecida na competência.",
    debitAccountCode: "1.1",
    creditAccountCode: "1.3",
    affectsPnl: false,
    implemented: true,
  },
  {
    eventType: "EXTRA_REVENUE_RECEIVED",
    name: "Receita Extra reconhecida e recebida",
    description:
      "Entrada sem cobrança a cliente: reconhece e recebe no mesmo fato (01 §3.6).",
    debitAccountCode: "1.1",
    creditAccountCode: "5.3",
    affectsPnl: true,
    implemented: true,
  },
  {
    eventType: "EXPENSE_RECOGNIZED_ON_CREDIT",
    name: "Despesa reconhecida a prazo",
    description: "A obrigação nasce na competência; o caixa sai depois.",
    debitAccountCode: "10.4",
    creditAccountCode: "2.1",
    affectsPnl: true,
    implemented: true,
  },
  {
    eventType: "EXPENSE_PAID_CASH",
    name: "Despesa paga à vista",
    description: "Reconhecimento e caixa no mesmo fato.",
    debitAccountCode: "10.4",
    creditAccountCode: "1.1",
    affectsPnl: true,
    implemented: true,
  },
  {
    eventType: "PAYABLE_SETTLED",
    name: "Pagamento de conta reconhecida",
    description:
      "Baixa da obrigação. NÃO cria despesa: ela já entrou no resultado quando foi reconhecida.",
    debitAccountCode: "2.1",
    creditAccountCode: "1.1",
    affectsPnl: false,
    implemented: false,
  },
  {
    eventType: "CARD_PURCHASE",
    name: "Compra no cartão",
    description: "A COMPRA é a despesa; o cartão vira passivo.",
    debitAccountCode: "10.4",
    creditAccountCode: "2.2",
    affectsPnl: true,
    implemented: false,
  },
  {
    eventType: "CARD_INVOICE_PAID",
    name: "Pagamento de fatura de cartão",
    description:
      "Reduz passivo e caixa. Sem nova despesa — a despesa foi a compra (evita a dupla contagem).",
    debitAccountCode: "2.2",
    creditAccountCode: "1.1",
    affectsPnl: false,
    implemented: false,
  },
  {
    eventType: "LOAN_RECEIVED",
    name: "Entrada de empréstimo",
    description: "Entra caixa e nasce passivo. Não é receita.",
    debitAccountCode: "1.1",
    creditAccountCode: "2.5",
    affectsPnl: false,
    implemented: false,
  },
  {
    eventType: "LOAN_PRINCIPAL_PAID",
    name: "Amortização de principal",
    description: "Reduz passivo e caixa. Principal NÃO é despesa (01 §3.11).",
    debitAccountCode: "2.5",
    creditAccountCode: "1.1",
    affectsPnl: false,
    implemented: false,
  },
  {
    eventType: "INTEREST_EXPENSE",
    name: "Juros",
    description: "A parte do empréstimo que É despesa.",
    debitAccountCode: "12.1",
    creditAccountCode: "1.1",
    affectsPnl: true,
    implemented: false,
  },
  {
    eventType: "ACCOUNT_TRANSFER",
    name: "Transferência entre contas ou reservas",
    description: "Move dinheiro de lugar. Não toca no resultado (01 §3.8).",
    debitAccountCode: "15.1",
    creditAccountCode: "1.1",
    affectsPnl: false,
    implemented: false,
  },
  {
    eventType: "TAX_PROVISIONED",
    name: "Provisão de imposto",
    description: "Reconhece a obrigação tributária da competência.",
    debitAccountCode: "11.1",
    creditAccountCode: "2.3",
    affectsPnl: true,
    implemented: false,
  },
  {
    eventType: "TAX_PAID",
    name: "Pagamento de imposto",
    description: "Baixa a obrigação; a despesa já foi na provisão.",
    debitAccountCode: "2.3",
    creditAccountCode: "1.1",
    affectsPnl: false,
    implemented: false,
  },
  {
    eventType: "CUSTOMER_REFUND",
    name: "Reembolso ao cliente",
    description: "Devolução de dinheiro: contra-receita conforme a origem.",
    debitAccountCode: "14.1",
    creditAccountCode: "1.1",
    affectsPnl: true,
    implemented: false,
  },
  {
    eventType: "RECEIVABLE_WRITE_OFF",
    name: "Write-off de recebível",
    description: "Reconhece a perda e baixa o recebível. Motivo obrigatório.",
    debitAccountCode: "14.2",
    creditAccountCode: "1.3",
    affectsPnl: true,
    implemented: false,
  },
  {
    eventType: "REVERSAL",
    name: "Reversal",
    description:
      "Neutraliza uma transação anterior invertendo as contas dela. É assim que se corrige — nunca apagando.",
    debitAccountCode: "(inverso do original)",
    creditAccountCode: "(inverso do original)",
    affectsPnl: false,
    implemented: false,
  },
];

export function getPostingRule(eventType: PostingEventType): PostingRuleSpec {
  const r = POSTING_RULES.find((x) => x.eventType === eventType);
  if (!r) throw new Error(`Evento "${eventType}" não está na matriz canônica (01 §3.10).`);
  return r;
}

/** Versão vigente da matriz — gravada em cada transação do razão. */
export const POSTING_RULES_VERSION = 1;

/** Bandeira que libera a postagem no razão (03 §4.6). */
export const LEDGER_FLAG = "ledger_enabled";
