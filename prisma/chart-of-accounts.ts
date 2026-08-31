/**
 * PLANO DE CONTAS CANÔNICO (03 §2.2) — fonte única do seed e dos testes.
 *
 * Cada conta declara a NATUREZA que o AccountingEngine usa:
 *  - accountType    ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
 *  - normalBalance  DEBIT (ativo/despesa) | CREDIT (passivo/PL/receita)
 *  - statementType  BALANCE_SHEET (patrimônio) | PNL (resultado, entra na DRE)
 *
 * Regras que a estrutura garante sozinha:
 *  - Caixa, reservas, cartões, empréstimos e impostos a pagar são
 *    BALANCE_SHEET → nunca entram na DRE (01 §3.11).
 *  - Principal de empréstimo é passivo; só o JURO é despesa (01 §3.10).
 *  - Transferências e reservas vivem no grupo 15, fora do resultado.
 *  - "Recuperação" (4.6) é classificação ANALÍTICA: o reconhecimento já
 *    aconteceu na competência original, não se duplica (01 §3.3).
 */

export type SeedAccount = {
  code: string;
  name: string;
  accountType: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  /** Conta folha (recebe lançamento) ou sintética (só agrega). */
  posting?: boolean;
  unclassified?: boolean;
};

/** Saldo normal é consequência do tipo — nunca digitado à mão. */
export function normalBalanceOf(t: SeedAccount["accountType"]): "DEBIT" | "CREDIT" {
  return t === "ASSET" || t === "EXPENSE" ? "DEBIT" : "CREDIT";
}

/** Entra na DRE? Só receita e despesa. */
export function statementTypeOf(
  t: SeedAccount["accountType"]
): "BALANCE_SHEET" | "PNL" {
  return t === "REVENUE" || t === "EXPENSE" ? "PNL" : "BALANCE_SHEET";
}

/** Nome do grupo raiz a partir do código ("4.1" → grupo "4"). */
export function rootCode(code: string): string {
  return code.split(".")[0];
}

export const CHART_OF_ACCOUNTS: SeedAccount[] = [
  // ===== 1 ATIVOS =====
  { code: "1", name: "Ativos", accountType: "ASSET", posting: false },
  { code: "1.1", name: "Caixa e bancos", accountType: "ASSET" },
  { code: "1.2", name: "Reservas", accountType: "ASSET" },
  { code: "1.3", name: "Contas a receber", accountType: "ASSET" },
  { code: "1.4", name: "Adiantamentos e créditos de clientes", accountType: "ASSET" },
  { code: "1.5", name: "Outros ativos", accountType: "ASSET" },

  // ===== 2 PASSIVOS =====
  { code: "2", name: "Passivos", accountType: "LIABILITY", posting: false },
  { code: "2.1", name: "Contas a pagar", accountType: "LIABILITY" },
  { code: "2.2", name: "Cartões a pagar", accountType: "LIABILITY" },
  { code: "2.3", name: "Impostos a pagar", accountType: "LIABILITY" },
  { code: "2.4", name: "Folha e comissões a pagar", accountType: "LIABILITY" },
  { code: "2.5", name: "Empréstimos e parcelamentos", accountType: "LIABILITY" },
  { code: "2.6", name: "Outros passivos", accountType: "LIABILITY" },

  // ===== 3 PATRIMÔNIO / SÓCIOS =====
  { code: "3", name: "Patrimônio e sócios", accountType: "EQUITY", posting: false },
  { code: "3.1", name: "Capital e ajustes", accountType: "EQUITY" },
  { code: "3.2", name: "Distribuições e retiradas", accountType: "EQUITY" },

  // ===== 4 RECEITAS OPERACIONAIS =====
  { code: "4", name: "Receitas operacionais", accountType: "REVENUE", posting: false },
  { code: "4.1", name: "MRR", accountType: "REVENUE" },
  { code: "4.2", name: "TCV", accountType: "REVENUE" },
  { code: "4.3", name: "Setup", accountType: "REVENUE" },
  { code: "4.4", name: "Avulso (one-time)", accountType: "REVENUE" },
  { code: "4.5", name: "Upsell", accountType: "REVENUE" },
  { code: "4.6", name: "Recuperação (classificação analítica)", accountType: "REVENUE" },

  // ===== 5 RECEITAS EXTRAS =====
  { code: "5", name: "Receitas extras", accountType: "REVENUE", posting: false },
  { code: "5.1", name: "Reembolso recebido", accountType: "REVENUE" },
  { code: "5.2", name: "Ajuste positivo", accountType: "REVENUE" },
  { code: "5.3", name: "Outras receitas extras", accountType: "REVENUE" },

  // ===== 6 CUSTOS DIRETOS =====
  { code: "6", name: "Custos diretos", accountType: "EXPENSE", posting: false },
  { code: "6.1", name: "Tráfego repassado", accountType: "EXPENSE" },
  { code: "6.2", name: "Criativos e freelancers", accountType: "EXPENSE" },
  { code: "6.3", name: "Comissão comercial", accountType: "EXPENSE" },
  { code: "6.4", name: "Comissão de renovação e upsell", accountType: "EXPENSE" },

  // ===== 7 FOLHA E PESSOAS =====
  { code: "7", name: "Folha e pessoas", accountType: "EXPENSE", posting: false },
  { code: "7.1", name: "Salários", accountType: "EXPENSE" },
  { code: "7.2", name: "Benefícios", accountType: "EXPENSE" },
  { code: "7.3", name: "Encargos", accountType: "EXPENSE" },
  { code: "7.4", name: "Bonificações", accountType: "EXPENSE" },
  { code: "7.5", name: "Pró-labore", accountType: "EXPENSE" },

  // ===== 8 a 15 =====
  { code: "8", name: "Ferramentas e softwares", accountType: "EXPENSE" },
  { code: "9", name: "Marketing e vendas da agência", accountType: "EXPENSE" },
  { code: "10", name: "Administrativas", accountType: "EXPENSE", posting: false },
  { code: "10.1", name: "Aluguel e escritório", accountType: "EXPENSE" },
  { code: "10.2", name: "Água, luz e internet", accountType: "EXPENSE" },
  { code: "10.3", name: "Transporte", accountType: "EXPENSE" },
  { code: "10.4", name: "Outras administrativas", accountType: "EXPENSE" },
  { code: "11", name: "Impostos e contabilidade", accountType: "EXPENSE", posting: false },
  { code: "11.1", name: "Impostos sobre faturamento", accountType: "EXPENSE" },
  { code: "11.2", name: "Honorários contábeis", accountType: "EXPENSE" },
  { code: "12", name: "Financeiras", accountType: "EXPENSE", posting: false },
  { code: "12.1", name: "Juros", accountType: "EXPENSE" },
  { code: "12.2", name: "Tarifas bancárias", accountType: "EXPENSE" },
  { code: "12.3", name: "Antecipações", accountType: "EXPENSE" },
  { code: "12.4", name: "Multas", accountType: "EXPENSE" },
  { code: "13", name: "Investimentos (capex gerencial)", accountType: "ASSET" },
  { code: "14", name: "Ajustes, contra-receita e perdas", accountType: "EXPENSE", posting: false },
  { code: "14.1", name: "Contra-receita (reembolso a cliente)", accountType: "EXPENSE" },
  { code: "14.2", name: "Perda com crédito (write-off)", accountType: "EXPENSE" },
  { code: "14.3", name: "Chargebacks e estornos", accountType: "EXPENSE" },
  { code: "15", name: "Transferência e controle", accountType: "ASSET", posting: false },
  { code: "15.1", name: "Transferência entre contas", accountType: "ASSET" },
  { code: "15.2", name: "Movimentação de reservas", accountType: "ASSET" },

  // ===== Não classificado — temporária (03 §2.2) =====
  {
    code: "99",
    name: "Não classificado",
    accountType: "EXPENSE",
    unclassified: true,
  },
];

/** Rótulo do grupo raiz, para a interface. */
export const GROUP_LABELS: Record<string, string> = {
  "1": "ATIVOS",
  "2": "PASSIVOS",
  "3": "PATRIMÔNIO/SÓCIOS",
  "4": "RECEITAS OPERACIONAIS",
  "5": "RECEITAS EXTRAS",
  "6": "CUSTOS DIRETOS",
  "7": "FOLHA E PESSOAS",
  "8": "FERRAMENTAS E SOFTWARES",
  "9": "MARKETING E VENDAS DA AGÊNCIA",
  "10": "ADMINISTRATIVAS",
  "11": "IMPOSTOS E CONTABILIDADE",
  "12": "FINANCEIRAS",
  "13": "INVESTIMENTOS/CAPEX GERENCIAL",
  "14": "AJUSTES/CONTRA-RECEITA/PERDAS",
  "15": "TRANSFERÊNCIA E CONTROLE",
  "99": "NÃO CLASSIFICADO",
};

/**
 * De→para das categorias do v1 para as contas novas. O que não casar fica
 * sem conta e aparece no alerta de "não classificado" — nunca é adivinhado.
 */
export const CATEGORY_TO_ACCOUNT: Record<string, string> = {
  "Tráfego Pago": "6.1",
  "Folha de Pagamento": "7.1",
  "Ferramentas": "8",
  "Aluguel / Escritório": "10.1",
  "Luz/Água": "10.2",
  "Transporte": "10.3",
  "Alimentação": "10.4",
  "Empresa": "10.4",
  "Impostos": "11.1",
  "Investimentos": "13",
  "Reserva de Emergência": "15.2",
  "Dívida a Receber": "1.3",
  "Reembolsável": "1.4",
  "Terceiros": "6.2",
  // Naturezas pessoais do dono (belongsTo pessoal/família): ficam em
  // Distribuições/retiradas, FORA do resultado operacional (01 §4.8).
  "Pessoal": "3.2",
  "Família": "3.2",
  "Lazer": "3.2",
  "Carro": "3.2",
  "Cabelo/Estética": "3.2",
};
