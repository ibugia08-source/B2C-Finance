/**
 * CATÁLOGO DE SCOPES DA API (28/09/2026) — fonte única, sem dependência de
 * servidor (a tela de Integrações importa daqui).
 *
 * Um scope diz o que uma CONTA DE SERVIÇO pode fazer pela API. Não é papel
 * nem permissão de pessoa: a conta não tem RBAC humano, só esta lista.
 *
 * Regras (docs/API_AUTHENTICATION.md):
 *  · formato `recurso.acao`, em inglês — é contrato público da API;
 *  · NÃO existe curinga, nem para quem cria a conta sendo ADMIN;
 *  · o que está em FORBIDDEN_SCOPES não entra no catálogo — logo, nem por
 *    engano pode ser concedido (exclusões, usuários, permissões, reabrir
 *    competência). Um teste garante que as duas listas não se cruzam.
 */

export type ApiScopeDef = {
  id: string;
  label: string;
  /** Escreve dados (a tela destaca). */
  write?: boolean;
};

export type ApiScopeGroup = { key: string; label: string; scopes: ApiScopeDef[] };

export const API_SCOPE_GROUPS: ApiScopeGroup[] = [
  {
    key: "clients",
    label: "Clientes",
    scopes: [
      { id: "clients.read", label: "Ler clientes" },
      { id: "clients.create", label: "Cadastrar clientes", write: true },
      { id: "clients.update", label: "Editar clientes", write: true },
    ],
  },
  {
    key: "client_status",
    label: "Status do cliente",
    scopes: [
      { id: "client_status.read", label: "Ler status e histórico com vigência" },
      { id: "client_status.write", label: "Alterar, programar e cancelar status", write: true },
    ],
  },
  {
    key: "receivables",
    label: "Recebimentos",
    scopes: [
      { id: "receivables.read", label: "Ler cobranças e recebimentos" },
      { id: "receivables.register_payment", label: "Registrar pagamento", write: true },
      { id: "receivables.remove_from_month", label: "Remover cobrança não paga do mês", write: true },
    ],
  },
  {
    key: "expenses",
    label: "Despesas",
    scopes: [
      { id: "expenses.read", label: "Ler despesas" },
      { id: "expenses.create", label: "Lançar despesas", write: true },
      { id: "expenses.update", label: "Editar despesas", write: true },
      { id: "expenses.pay", label: "Marcar despesa como paga", write: true },
    ],
  },
  {
    key: "cash",
    label: "Caixa",
    scopes: [{ id: "cash.read", label: "Ler caixa e saldos" }],
  },
  {
    key: "upsells",
    label: "Upsell",
    scopes: [
      { id: "upsells.read", label: "Ler oportunidades" },
      { id: "upsells.create", label: "Cadastrar oportunidades", write: true },
      { id: "upsells.update", label: "Atualizar oportunidades", write: true },
    ],
  },
  {
    key: "insights",
    label: "Painéis e relatórios",
    scopes: [
      { id: "dashboard.read", label: "Ler indicadores do dashboard" },
      { id: "routine.read", label: "Ler a rotina do dia" },
      { id: "routine.write", label: "Concluir ações da rotina do dia", write: true },
      { id: "reports.read", label: "Executar relatórios" },
    ],
  },
  {
    key: "integration",
    label: "Integração",
    scopes: [
      {
        id: "identities.resolve",
        label: "Identificar quem fala (Telegram/WhatsApp → usuário) e agir com as permissões dele",
      },
      {
        id: "knowledge.read",
        label: "Ler a base de conhecimento (documentação para indexar no agente)",
      },
      {
        id: "agent_actions.manage",
        label: "Propor ações do agente e executá-las após a confirmação do usuário",
        write: true,
      },
    ],
  },
];

export const API_SCOPES: string[] = API_SCOPE_GROUPS.flatMap((g) => g.scopes.map((s) => s.id));
export type ApiScope = (typeof API_SCOPES)[number];

const API_SCOPE_SET = new Set(API_SCOPES);

/**
 * NUNCA concedíveis a uma conta de serviço. Ficam registrados aqui para o
 * teste provar que ninguém os acrescentou ao catálogo — e para a validação
 * dar uma mensagem clara se alguém tentar mandá-los.
 */
export const FORBIDDEN_SCOPES = new Set<string>([
  "users.manage",
  "permissions.manage",
  "clients.delete",
  "receivables.delete",
  "competences.reopen",
  "payments.delete",
  "expenses.delete",
  "chart_of_accounts.manage",
]);

export function isApiScope(s: string): boolean {
  return API_SCOPE_SET.has(s);
}

/**
 * Normaliza a lista pedida: sem duplicata, na ordem do catálogo. Qualquer
 * item fora do catálogo (inclusive curinga e proibidos) recusa TUDO — um
 * pedido meio aceito é pior que um erro, porque a integração sai com menos
 * poder do que quem a criou acha que deu.
 */
export function parseApiScopes(
  pedidos: readonly string[]
): { ok: true; scopes: string[] } | { ok: false; error: string } {
  const set = new Set(pedidos.map((s) => s.trim()).filter(Boolean));
  for (const s of set) {
    if (FORBIDDEN_SCOPES.has(s)) return { ok: false, error: `O scope “${s}” não pode ser concedido a integrações.` };
    if (!API_SCOPE_SET.has(s)) return { ok: false, error: `Scope desconhecido: “${s}”.` };
  }
  if (set.size === 0) return { ok: false, error: "Selecione ao menos um scope." };
  return { ok: true, scopes: API_SCOPES.filter((s) => set.has(s)) };
}

export function apiScopeLabel(id: string): string {
  for (const g of API_SCOPE_GROUPS) for (const s of g.scopes) if (s.id === id) return s.label;
  return id;
}

/**
 * PERMISSÃO DO RBAC → SCOPE que a cobre, para quando uma função de domínio
 * (ou a guarda de um motor) pergunta "pode?" a uma CONTA DE SERVIÇO.
 *
 * Defesa em profundidade: o endpoint já confere o scope na entrada
 * (`requireApiScope`); isto garante que, se um endpoint chamar uma função
 * que faz mais do que ele declarou, a conta ainda esbarra no próprio limite.
 * Permissão SEM entrada aqui = negada à conta (fail-closed): exclusões,
 * usuários, fechamento, folha etc. nunca são alcançáveis pela API.
 */
export const PERMISSION_TO_SCOPE: Readonly<Record<string, string>> = {
  "clientes.visualizar": "clients.read",
  "clientes.ver_dados_financeiros": "clients.read",
  "clientes.criar": "clients.create",
  "clientes.editar": "clients.update",
  "clientes.alterar_status": "client_status.write",
  "clientes.programar_status": "client_status.write",
  "clientes.alterar_status_retroativo": "client_status.write",
  "recebimentos.visualizar": "receivables.read",
  "recebimentos.ver_inadimplencia": "receivables.read",
  "recebimentos.registrar_pagamento": "receivables.register_payment",
  "rotina.registrar_pagamento": "receivables.register_payment",
  "despesas.visualizar": "expenses.read",
  "despesas.criar": "expenses.create",
  "despesas.editar": "expenses.update",
  "despesas.marcar_como_paga": "expenses.pay",
  "caixa.visualizar": "cash.read",
  "upsell.visualizar": "upsells.read",
  "upsell.criar": "upsells.create",
  "upsell.editar": "upsells.update",
  "upsell.marcar_vendido": "upsells.update",
  "dashboard.visualizar": "dashboard.read",
  "dashboard.ver_financeiro": "dashboard.read",
  "rotina.visualizar": "routine.read",
  "rotina.concluir_acao": "routine.write",
  "relatorios.visualizar": "reports.read",
};

/** A conta de serviço com estes scopes pode o que a permissão pede? */
export function scopePermite(scopes: readonly string[], permission: string): boolean {
  const scope = PERMISSION_TO_SCOPE[permission];
  return !!scope && scopes.includes(scope);
}

/**
 * SCOPE → PERMISSÕES DO RBAC que um USUÁRIO precisa ter para a integração
 * agir em nome dele com aquele scope (delegação via X-B2C-Identity).
 * Todas as permissões da lista são exigidas. Scope sem entrada aqui NUNCA
 * é delegável (ex.: identities.resolve — é da máquina, não da pessoa).
 */
export const SCOPE_REQUIRES_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  "clients.read": ["clientes.visualizar"],
  "clients.create": ["clientes.criar"],
  "clients.update": ["clientes.editar"],
  "client_status.read": ["clientes.visualizar"],
  "client_status.write": ["clientes.alterar_status"],
  "receivables.read": ["recebimentos.visualizar"],
  "receivables.register_payment": ["recebimentos.registrar_pagamento"],
  "receivables.remove_from_month": ["recebimentos.excluir"],
  "expenses.read": ["despesas.visualizar"],
  "expenses.create": ["despesas.criar"],
  "expenses.update": ["despesas.editar"],
  "expenses.pay": ["despesas.marcar_como_paga"],
  "cash.read": ["caixa.visualizar"],
  "upsells.read": ["upsell.visualizar"],
  "upsells.create": ["upsell.criar"],
  "upsells.update": ["upsell.editar"],
  "dashboard.read": ["dashboard.visualizar", "dashboard.ver_financeiro"],
  "routine.read": ["rotina.visualizar"],
  "routine.write": ["rotina.concluir_acao"],
  "reports.read": ["relatorios.visualizar"],
  // Propor/confirmar não escreve nada sozinho: a ação confirmada passa pela
  // rota de escrita, que exige o scope DELA (e o RBAC da pessoa). Por isso
  // não pede permissão própria — só existe para a conta optar por escrita.
  "agent_actions.manage": [],
};

/**
 * Permissões FINAS que a integração precisa conhecer além dos scopes: rotas
 * que exigem mais que o scope (`permissaoDoUsuario` em defineEndpoint). A
 * resolução de identidade as devolve em `permissions` para o agente saber
 * quais ferramentas oferecer — a rota confere de novo.
 */
export const PERMISSOES_FINAS_DA_INTEGRACAO: readonly string[] = ["recebimentos.ver_inadimplencia"];

/**
 * Scopes EFETIVOS quando a integração age por um usuário: os da conta de
 * serviço ∩ os que o RBAC da pessoa cobre. Nunca amplia nada.
 */
export function scopesDoUsuario(
  scopesDaConta: readonly string[],
  pode: (permission: string) => boolean
): string[] {
  const efetivos = scopesDaConta.filter((s) => {
    const exige = SCOPE_REQUIRES_PERMISSIONS[s];
    return !!exige && exige.every(pode);
  });
  // Propor ações só faz sentido para quem pode escrever ALGO: sem nenhum
  // scope de escrita delegado, o agente segue somente leitura para ele.
  const escreve = efetivos.some((s) => s !== "agent_actions.manage" && ESCRITA.has(s));
  return escreve ? efetivos : efetivos.filter((s) => s !== "agent_actions.manage");
}

const ESCRITA = new Set(API_SCOPE_GROUPS.flatMap((g) => g.scopes.filter((s) => s.write).map((s) => s.id)));
