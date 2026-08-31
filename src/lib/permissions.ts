/**
 * Catálogo CENTRAL de papéis e permissões (RBAC) — fonte única da verdade.
 *
 * Sem dependência de servidor: importável por client components (matriz de
 * permissões), pela sidebar e pelas server actions.
 *
 * Conceito:
 *  - Cada usuário tem um PAPEL (role) com um conjunto padrão de permissões
 *    (ROLE_PERMISSIONS).
 *  - Ajustes finos por usuário vivem em UserPermission e guardam SÓ as
 *    diferenças vs. o padrão do papel: enabled=true concede além do papel,
 *    enabled=false revoga algo do papel. Restaurar padrão = apagar as linhas.
 *  - ADMIN sempre tem acesso total (regra fixa, não configurável).
 *
 * Nomenclatura dos ids: "modulo.acao", em português, alinhada à interface
 * (ex.: "clientes.criar"). Nada de resource/scope/claim na UI.
 */

export type Role =
  | "ADMIN"
  | "GESTOR"
  | "FINANCEIRO"
  | "ADMINISTRATIVO"
  | "COMERCIAL"
  | "COBRANCA"
  // Papéis de 03 §1.1 acrescentados na F1.10.
  | "CLOSER"
  | "SDR"
  | "SUPORTE"
  | "CONTADOR"
  | "LEITURA"
  | "USER";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  FINANCEIRO: "Financeiro",
  ADMINISTRATIVO: "Administrativo",
  COMERCIAL: "Comercial",
  COBRANCA: "Cobrança / Atendimento",
  CLOSER: "Closer",
  SDR: "SDR",
  SUPORTE: "Suporte / Automação",
  CONTADOR: "Contador",
  LEITURA: "Leitura",
  USER: "Usuário (legado)",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  ADMIN: "Acesso total a todos os módulos e configurações.",
  GESTOR: "Acesso amplo de operação, sem exclusões nem gestão de usuários.",
  FINANCEIRO: "Recebimentos, despesas, caixa (ver) e relatórios.",
  ADMINISTRATIVO: "Cadastro de clientes, acompanhamento e rotina diária.",
  COMERCIAL: "Clientes, contratos, upsell e catálogo de serviços.",
  COBRANCA: "Cobrança do dia a dia: recebimentos, mensagens e rotina.",
  CLOSER: "Funil, proposta e fechamento de venda. Não vê financeiro nem folha.",
  SDR: "Prospecção e agendamento. Registra atividade do dia; não vê valores.",
  SUPORTE: "Onboarding e rotina operacional do cliente. Não vê valores.",
  CONTADOR: "Só leitura do contábil e dos relatórios, para exportação. Não opera nada.",
  LEITURA: "Só olha: dashboard e carteira, sem nenhum valor sensível.",
  USER: "Acesso mínimo (Assistente e Dashboard). Papel antigo, mantido por compatibilidade.",
};

/** Papéis oferecidos no cadastro (USER fica de fora — legado). */
export const ASSIGNABLE_ROLES: Role[] = [
  "ADMIN",
  "GESTOR",
  "FINANCEIRO",
  "ADMINISTRATIVO",
  "COMERCIAL",
  "COBRANCA",
  "CLOSER",
  "SDR",
  "SUPORTE",
  "CONTADOR",
  "LEITURA",
];

export function isKnownRole(role: string): role is Role {
  return role in ROLE_LABEL;
}

// ---------------------------------------------------------------------------
// Catálogo de permissões por módulo (também alimenta a matriz da interface)
// ---------------------------------------------------------------------------

export type PermissionDef = {
  id: string;
  /** Texto humano exibido na matriz ("Pode …"). */
  label: string;
  /** Permissão sensível → destaque visual na interface. */
  sensitive?: boolean;
};

export type PermissionModule = {
  key: string;
  label: string;
  permissions: PermissionDef[];
};

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    key: "assistente",
    label: "Assistente IA",
    permissions: [{ id: "assistente.visualizar", label: "Usar o Assistente IA" }],
  },
  {
    key: "dashboard",
    label: "Dashboard",
    permissions: [
      { id: "dashboard.visualizar", label: "Ver o Dashboard" },
      {
        id: "dashboard.ver_financeiro",
        label: "Ver números financeiros (resultado, margem, caixa)",
        sensitive: true,
      },
    ],
  },
  {
    key: "clientes",
    label: "Clientes",
    permissions: [
      { id: "clientes.visualizar", label: "Ver clientes" },
      { id: "clientes.criar", label: "Cadastrar clientes" },
      { id: "clientes.editar", label: "Editar clientes" },
      { id: "clientes.alterar_status", label: "Alterar status" },
      { id: "clientes.anexar_documentos", label: "Anexar documentos" },
      {
        id: "clientes.ver_dados_financeiros",
        label: "Ver valores e histórico financeiro do cliente",
        sensitive: true,
      },
      { id: "clientes.excluir", label: "Excluir clientes", sensitive: true },
    ],
  },
  {
    key: "recebimentos",
    label: "Recebimentos",
    permissions: [
      { id: "recebimentos.visualizar", label: "Ver recebimentos" },
      { id: "recebimentos.registrar_pagamento", label: "Registrar pagamento" },
      { id: "recebimentos.gerar_cobranca", label: "Gerar cobrança / mensagem" },
      { id: "recebimentos.editar", label: "Editar cobranças" },
      { id: "recebimentos.alterar_vencimento", label: "Alterar vencimento" },
      { id: "recebimentos.ver_inadimplencia", label: "Ver inadimplência" },
      { id: "recebimentos.excluir", label: "Excluir cobranças e pagamentos", sensitive: true },
    ],
  },
  {
    key: "despesas",
    label: "Despesas",
    permissions: [
      { id: "despesas.visualizar", label: "Ver despesas" },
      { id: "despesas.criar", label: "Criar despesas" },
      { id: "despesas.editar", label: "Editar despesas" },
      { id: "despesas.marcar_como_paga", label: "Marcar despesa como paga" },
      { id: "despesas.excluir", label: "Excluir despesas", sensitive: true },
    ],
  },
  {
    key: "receitas",
    label: "Receita Extra",
    permissions: [
      { id: "receitas.visualizar", label: "Ver receitas extras" },
      { id: "receitas.criar", label: "Lançar receita extra" },
      { id: "receitas.editar", label: "Editar receita extra" },
      { id: "receitas.excluir", label: "Excluir receita extra", sensitive: true },
    ],
  },
  {
    key: "caixa",
    label: "Reservas (caixa)",
    permissions: [
      { id: "caixa.visualizar", label: "Ver caixa e reservas", sensitive: true },
      { id: "caixa.lancar", label: "Lançar valores no caixa", sensitive: true },
      { id: "caixa.editar", label: "Editar lançamentos", sensitive: true },
      { id: "caixa.excluir", label: "Excluir lançamentos", sensitive: true },
    ],
  },
  {
    key: "contratos",
    label: "Contratos",
    permissions: [
      { id: "contratos.visualizar", label: "Ver contratos" },
      { id: "contratos.criar", label: "Criar contratos" },
      { id: "contratos.editar", label: "Editar contratos" },
      { id: "contratos.gerar_contrato", label: "Gerar contrato (documento)" },
      { id: "contratos.baixar_contrato", label: "Baixar contrato" },
      { id: "contratos.excluir", label: "Excluir contratos", sensitive: true },
    ],
  },
  {
    key: "upsell",
    label: "Upsell",
    permissions: [
      { id: "upsell.visualizar", label: "Ver oportunidades" },
      { id: "upsell.criar", label: "Cadastrar oportunidades" },
      { id: "upsell.editar", label: "Editar oportunidades" },
      { id: "upsell.marcar_vendido", label: "Marcar como vendido" },
      { id: "upsell.excluir", label: "Excluir oportunidades", sensitive: true },
    ],
  },
  {
    key: "folha",
    label: "Folha",
    permissions: [
      { id: "folha.visualizar", label: "Ver folha e comissões", sensitive: true },
      { id: "folha.editar", label: "Editar folha e comissões", sensitive: true },
    ],
  },
  {
    key: "servicos",
    label: "Serviços",
    permissions: [
      { id: "servicos.visualizar", label: "Ver serviços" },
      { id: "servicos.gerenciar", label: "Criar, editar e excluir serviços" },
    ],
  },
  {
    key: "ofertas",
    label: "Planos (Ofertas)",
    permissions: [
      { id: "ofertas.visualizar", label: "Ver planos e ofertas" },
      { id: "ofertas.gerenciar", label: "Criar, editar e excluir ofertas" },
    ],
  },
  {
    key: "rotina",
    label: "Rotina diária",
    permissions: [
      { id: "rotina.visualizar", label: "Ver a rotina diária" },
      { id: "rotina.registrar_pagamento", label: "Registrar pagamento pela rotina" },
      { id: "rotina.gerar_cobranca", label: "Gerar cobrança pela rotina" },
      { id: "rotina.concluir_acao", label: "Concluir/remover itens do dia" },
    ],
  },
  {
    key: "relatorios",
    label: "Relatórios",
    permissions: [
      { id: "relatorios.visualizar", label: "Ver relatórios" },
      { id: "relatorios.exportar", label: "Exportar relatórios", sensitive: true },
    ],
  },
  {
    key: "projecoes",
    label: "Projeções",
    permissions: [{ id: "projecoes.visualizar", label: "Ver projeções" }],
  },
  {
    key: "importacoes",
    label: "Importar dados",
    permissions: [
      { id: "importacoes.visualizar", label: "Ver importações" },
      { id: "importacoes.importar", label: "Importar dados", sensitive: true },
    ],
  },
  {
    key: "regras",
    label: "Regras de categoria",
    permissions: [
      { id: "regras.visualizar", label: "Ver regras" },
      { id: "regras.gerenciar", label: "Criar, editar e excluir regras" },
    ],
  },
  // -------------------------------------------------------------------------
  // Permissões novas da reestruturação (03 §1.2). Duas ausências são
  // DECISÃO, não esquecimento:
  //   · "Aprovações (solicitar/decidir)" e "Rateios: aprovar" não existem —
  //     19.35/19.36 em 31/08: sem teto e sem fila de aprovação.
  //   · "Avaliação: editar (escopo meus clientes)" perdeu o "meus clientes" —
  //     19.11: usuário do sistema não é ligado a pessoa da folha, então esse
  //     recorte não é derivável. O recorte agora é a AGÊNCIA (ver lib/scope).
  // -------------------------------------------------------------------------
  {
    key: "organizacao",
    label: "Entidades e Agências",
    permissions: [
      { id: "organizacao.visualizar", label: "Ver entidades e agências" },
      { id: "organizacao.gerenciar", label: "Criar e editar entidades e agências", sensitive: true },
    ],
  },
  {
    key: "termos",
    label: "Preço e termos comerciais",
    permissions: [
      { id: "termos.visualizar", label: "Ver preço vigente e histórico de termos", sensitive: true },
      { id: "termos.editar", label: "Abrir novo termo (mudar o preço do cliente)", sensitive: true },
    ],
  },
  {
    key: "avaliacao",
    label: "Avaliação mensal",
    permissions: [
      { id: "avaliacao.visualizar", label: "Ver a avaliação mensal" },
      { id: "avaliacao.editar", label: "Preencher e confirmar avaliação" },
    ],
  },
  {
    key: "onboarding",
    label: "Onboarding",
    permissions: [
      { id: "onboarding.visualizar", label: "Ver o onboarding do cliente" },
      { id: "onboarding.operar", label: "Concluir tarefas e encerrar o onboarding" },
    ],
  },
  {
    key: "creditos",
    label: "Créditos de cliente",
    permissions: [
      { id: "creditos.visualizar", label: "Ver crédito e adiantamento do cliente", sensitive: true },
      { id: "creditos.operar", label: "Aplicar crédito em cobrança", sensitive: true },
      { id: "creditos.ajustar", label: "Ajustar e estornar crédito", sensitive: true },
    ],
  },
  {
    key: "contabil",
    label: "Contábil (razão e DRE)",
    permissions: [
      { id: "contabil.visualizar", label: "Ver razão e DRE", sensitive: true },
      { id: "contabil.lancar", label: "Lançar manualmente no razão", sensitive: true },
      { id: "contabil.exportar", label: "Exportar para o contador", sensitive: true },
    ],
  },
  {
    key: "fechamento",
    label: "Fechamento do mês",
    permissions: [
      // DECIDIDO 19.16: fecha e reabre o dono; a permissão é CONCEDÍVEL aqui.
      { id: "fechamento.fechar", label: "Fechar a competência", sensitive: true },
      { id: "fechamento.reabrir", label: "Reabrir competência fechada", sensitive: true },
      { id: "fechamento.fotografar", label: "Gerar fotografia avulsa", sensitive: true },
    ],
  },
  {
    key: "conciliacao",
    label: "Conciliação bancária",
    permissions: [
      { id: "conciliacao.visualizar", label: "Ver a conciliação", sensitive: true },
      { id: "conciliacao.conciliar", label: "Conciliar lançamentos", sensitive: true },
      { id: "conciliacao.ajustar", label: "Lançar ajuste de conciliação", sensitive: true },
    ],
  },
  {
    key: "fiscal",
    label: "Notas fiscais",
    permissions: [
      // DECIDIDO 19.38: registro OPCIONAL — a maioria dos serviços não emite NF.
      { id: "fiscal.visualizar", label: "Ver notas registradas" },
      { id: "fiscal.registrar", label: "Registrar nota emitida" },
      { id: "fiscal.cancelar", label: "Cancelar registro de nota", sensitive: true },
    ],
  },
  {
    key: "rateios",
    label: "Rateios",
    permissions: [
      { id: "rateios.visualizar", label: "Ver rateios", sensitive: true },
      { id: "rateios.editar", label: "Criar e editar regras de rateio", sensitive: true },
    ],
  },
  {
    key: "comercial",
    label: "Comercial (funil)",
    permissions: [
      { id: "comercial.visualizar", label: "Ver o funil" },
      { id: "comercial.operar", label: "Mover e editar oportunidades" },
      { id: "comercial.registrar_venda", label: "Registrar venda (marcar ganho)" },
      { id: "comercial.metas", label: "Definir metas", sensitive: true },
    ],
  },
  {
    key: "auditoria",
    label: "Auditoria",
    permissions: [
      { id: "auditoria.visualizar", label: "Ver a trilha de auditoria", sensitive: true },
    ],
  },
  {
    key: "motor",
    label: "Motor (regras contábeis e métricas)",
    permissions: [
      { id: "motor.regras_contabeis", label: "Alterar regras de lançamento", sensitive: true },
      { id: "motor.metricas", label: "Alterar a definição das métricas", sensitive: true },
    ],
  },
  {
    key: "usuarios",
    label: "Usuários",
    permissions: [
      { id: "usuarios.visualizar", label: "Ver usuários", sensitive: true },
      { id: "usuarios.criar", label: "Criar usuários", sensitive: true },
      { id: "usuarios.editar", label: "Editar usuários", sensitive: true },
      { id: "usuarios.excluir", label: "Excluir usuários", sensitive: true },
      { id: "usuarios.alterar_permissoes", label: "Alterar permissões", sensitive: true },
    ],
  },
  {
    key: "configuracoes",
    label: "Configurações",
    permissions: [
      { id: "configuracoes.visualizar", label: "Ver configurações" },
      { id: "configuracoes.editar", label: "Alterar configurações", sensitive: true },
    ],
  },
];

/** Todos os ids válidos do catálogo. */
export const ALL_PERMISSION_IDS: string[] = PERMISSION_MODULES.flatMap((m) =>
  m.permissions.map((p) => p.id)
);

const ALL_PERMISSION_SET = new Set(ALL_PERMISSION_IDS);

export function isKnownPermission(id: string): boolean {
  return ALL_PERMISSION_SET.has(id);
}

/**
 * Permissões que NENHUM papel recebe por padrão e que a matriz mostra
 * travadas: mexer nelas muda como o sistema calcula, não o que o usuário vê.
 * 03 §1.2 as marca "sensível, Admin".
 */
export const ADMIN_ONLY_PERMISSIONS = new Set<string>([
  "motor.regras_contabeis",
  "motor.metricas",
]);

/**
 * FOLHA É DO DONO (DECIDIDO 19.11 em 31/08).
 *
 * Nenhum papel — nem GESTOR, nem FINANCEIRO — nasce com folha.*. Não é
 * descuido: a direção decidiu que salário e comissão só o dono enxerga, e
 * conceder isso é gesto explícito no painel de permissões, um usuário por vez.
 *
 * O outro lado da mesma decisão: a pessoa da FOLHA e o USUÁRIO do sistema são
 * registros independentes e nunca são casados automaticamente. Raiane e Bianca
 * existem nos dois lugares sem nenhum vínculo, de propósito.
 */
export const PERMISSOES_DO_DONO = new Set<string>([
  "folha.visualizar",
  "folha.editar",
]);

// ---------------------------------------------------------------------------
// Permissões padrão de cada papel
// ---------------------------------------------------------------------------

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  // Acesso total — regra fixa em hasPermission, o "*" aqui é só documental.
  ADMIN: ["*"],

  // Quase completo, sem permissões críticas (exclusões, usuários, config).
  GESTOR: [
    "assistente.visualizar",
    "dashboard.visualizar",
    "dashboard.ver_financeiro",
    "clientes.visualizar",
    "clientes.criar",
    "clientes.editar",
    "clientes.alterar_status",
    "clientes.anexar_documentos",
    "clientes.ver_dados_financeiros",
    "recebimentos.visualizar",
    "recebimentos.registrar_pagamento",
    "recebimentos.gerar_cobranca",
    "recebimentos.editar",
    "recebimentos.alterar_vencimento",
    "recebimentos.ver_inadimplencia",
    "despesas.visualizar",
    "despesas.criar",
    "despesas.editar",
    "despesas.marcar_como_paga",
    "receitas.visualizar",
    "receitas.criar",
    "receitas.editar",
    "caixa.visualizar",
    "contratos.visualizar",
    "contratos.criar",
    "contratos.editar",
    "contratos.gerar_contrato",
    "contratos.baixar_contrato",
    "upsell.visualizar",
    "upsell.criar",
    "upsell.editar",
    "upsell.marcar_vendido",
    "servicos.visualizar",
    "ofertas.visualizar",
    "rotina.visualizar",
    "rotina.registrar_pagamento",
    "rotina.gerar_cobranca",
    "rotina.concluir_acao",
    "relatorios.visualizar",
    "projecoes.visualizar",
    // Novas da reestruturação, no mesmo nível que o papel já tinha:
    "organizacao.visualizar",
    "termos.visualizar",
    "avaliacao.visualizar",
    "avaliacao.editar",
    "onboarding.visualizar",
    "onboarding.operar",
    "comercial.visualizar",
    "fiscal.visualizar",
  ],

  // Gestão financeira do dia a dia.
  FINANCEIRO: [
    "assistente.visualizar",
    "dashboard.visualizar",
    "dashboard.ver_financeiro",
    // Ver clientes: sem isto, todo link de nome de cliente (Gestão do Mês,
    // Rotina, Inadimplência) caía em "Acesso restrito" e a seção Renovações
    // sumia justamente para quem registra o pagamento (auditoria 2026-08-13).
    "clientes.visualizar",
    "recebimentos.visualizar",
    "recebimentos.registrar_pagamento",
    "recebimentos.gerar_cobranca",
    "recebimentos.editar",
    "recebimentos.alterar_vencimento",
    "recebimentos.ver_inadimplencia",
    "despesas.visualizar",
    "despesas.criar",
    "despesas.editar",
    "despesas.marcar_como_paga",
    "receitas.visualizar",
    "receitas.criar",
    "receitas.editar",
    "caixa.visualizar",
    "rotina.visualizar",
    "rotina.registrar_pagamento",
    "rotina.gerar_cobranca",
    "rotina.concluir_acao",
    "relatorios.visualizar",
    // Novas da reestruturação:
    "creditos.visualizar",
    "creditos.operar",
    "conciliacao.visualizar",
    "fiscal.visualizar",
    "fiscal.registrar",
    "avaliacao.visualizar",
    "onboarding.visualizar",
  ],

  // Organização operacional/cadastral.
  ADMINISTRATIVO: [
    "assistente.visualizar",
    "dashboard.visualizar",
    "clientes.visualizar",
    "clientes.criar",
    "clientes.editar",
    "clientes.alterar_status",
    "clientes.anexar_documentos",
    "recebimentos.visualizar",
    "rotina.visualizar",
    "rotina.concluir_acao",
    "onboarding.visualizar",
    "onboarding.operar",
    "avaliacao.visualizar",
  ],

  // Clientes, contratos, upsell e catálogo.
  COMERCIAL: [
    "assistente.visualizar",
    "dashboard.visualizar",
    "clientes.visualizar",
    "clientes.criar",
    "clientes.editar",
    "clientes.alterar_status",
    "contratos.visualizar",
    "contratos.criar",
    "contratos.editar",
    "contratos.gerar_contrato",
    "contratos.baixar_contrato",
    "upsell.visualizar",
    "upsell.criar",
    "upsell.editar",
    "upsell.marcar_vendido",
    "servicos.visualizar",
    "ofertas.visualizar",
    "termos.visualizar",
    "comercial.visualizar",
    "comercial.operar",
    "comercial.registrar_venda",
  ],

  // Cobrança e rotina.
  COBRANCA: [
    "assistente.visualizar",
    "dashboard.visualizar",
    "clientes.visualizar",
    "recebimentos.visualizar",
    "recebimentos.registrar_pagamento",
    "recebimentos.gerar_cobranca",
    "recebimentos.ver_inadimplencia",
    "rotina.visualizar",
    "rotina.registrar_pagamento",
    "rotina.gerar_cobranca",
    "rotina.concluir_acao",
    "creditos.visualizar",
  ],

  // Fecha venda: funil, contrato e catálogo. Sem financeiro e sem folha.
  CLOSER: [
    "assistente.visualizar",
    "dashboard.visualizar",
    "clientes.visualizar",
    "clientes.criar",
    "contratos.visualizar",
    "contratos.criar",
    "contratos.gerar_contrato",
    "contratos.baixar_contrato",
    "comercial.visualizar",
    "comercial.operar",
    "comercial.registrar_venda",
    "servicos.visualizar",
    "ofertas.visualizar",
    "upsell.visualizar",
    "upsell.criar",
    "upsell.editar",
    "upsell.marcar_vendido",
  ],

  // Prospecta e agenda. Registra a própria atividade; não vê valor nenhum.
  SDR: [
    "assistente.visualizar",
    "dashboard.visualizar",
    "comercial.visualizar",
    "comercial.operar",
    "rotina.visualizar",
    "rotina.concluir_acao",
  ],

  // Toca a operação do cliente: onboarding e rotina. Sem valores.
  SUPORTE: [
    "assistente.visualizar",
    "dashboard.visualizar",
    "clientes.visualizar",
    "onboarding.visualizar",
    "onboarding.operar",
    "avaliacao.visualizar",
    "rotina.visualizar",
    "rotina.concluir_acao",
  ],

  // Só leitura, para fechar com o escritório. Não opera nada, não edita nada.
  // O recorte "só períodos FECHADOS" de 03 §1.1 chega com o ClosingPeriod na
  // F2.1 — hoje o papel já não tem nenhuma permissão de escrita, que é a
  // metade da regra que dá para cumprir agora.
  CONTADOR: [
    "dashboard.visualizar",
    "contabil.visualizar",
    "contabil.exportar",
    "fiscal.visualizar",
    "relatorios.visualizar",
    "relatorios.exportar",
  ],

  // Olha e pronto.
  LEITURA: ["dashboard.visualizar", "clientes.visualizar"],

  // Papel legado: preserva o acesso que o USER tinha antes do RBAC
  // (itens não-adminOnly da navegação antiga).
  USER: ["assistente.visualizar", "dashboard.visualizar"],
};

// ---------------------------------------------------------------------------
// Checagem
// ---------------------------------------------------------------------------

export type PermissionOverride = { permission: string; enabled: boolean };

export type PermissionUser = {
  role: string;
  /** Linhas de UserPermission (diferenças vs. o papel). */
  permissions?: PermissionOverride[] | null;
};

/**
 * Função central de checagem. Regras, nesta ordem:
 *  1. sem usuário → false;
 *  2. ADMIN → true (sempre, não configurável);
 *  3. ajuste fino explícito do usuário (UserPermission) vence o papel;
 *  4. senão, vale o padrão do papel (ROLE_PERMISSIONS).
 */
export function hasPermission(user: PermissionUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;

  const override = user.permissions?.find((p) => p.permission === permission);
  if (override) return override.enabled;

  const defaults = ROLE_PERMISSIONS[user.role as Role] ?? [];
  if (defaults.includes("*")) return true;
  return defaults.includes(permission);
}

/**
 * Conjunto EFETIVO de permissões (papel + ajustes finos), já expandido.
 * Usado pela sidebar e pela matriz da interface.
 */
export function effectivePermissions(user: PermissionUser | null | undefined): Set<string> {
  if (!user) return new Set();
  if (user.role === "ADMIN") return new Set(ALL_PERMISSION_IDS);

  const defaults = ROLE_PERMISSIONS[user.role as Role] ?? [];
  const set = new Set(defaults.includes("*") ? ALL_PERMISSION_IDS : defaults);
  for (const o of user.permissions ?? []) {
    if (!isKnownPermission(o.permission)) continue;
    if (o.enabled) set.add(o.permission);
    else set.delete(o.permission);
  }
  return set;
}

// Helpers semânticos (evitam ids soltos espalhados pelos componentes).
export const canViewModule = (u: PermissionUser | null, moduleKey: string) =>
  hasPermission(u, `${moduleKey}.visualizar`);
export const canCreate = (u: PermissionUser | null, moduleKey: string) =>
  hasPermission(u, `${moduleKey}.criar`);
export const canEdit = (u: PermissionUser | null, moduleKey: string) =>
  hasPermission(u, `${moduleKey}.editar`);
export const canDelete = (u: PermissionUser | null, moduleKey: string) =>
  hasPermission(u, `${moduleKey}.excluir`);
export const canExport = (u: PermissionUser | null, moduleKey: string) =>
  hasPermission(u, `${moduleKey}.exportar`);

// ---------------------------------------------------------------------------
// PERMISSÃO DE CAMPO (03 §1.1: "campos sensíveis têm permissão de campo além
// da de tela")
// ---------------------------------------------------------------------------

/**
 * Por que isso existe além da permissão de tela: um valor sensível não vaza só
 * pela tela que é dona dele. O salário mora na Folha, mas reaparece no total de
 * despesas do Dashboard, na linha de pessoal do DRE e em qualquer relatório
 * exportado. Esconder a tela e deixar o número passar por outra porta seria uma
 * proteção de fachada — é o tipo de furo que a auditoria de 13/08 achou no
 * cache e que a decisão 19.11 não admite na folha.
 *
 * O campo aponta para a permissão que MANDA nele, seja qual for a tela.
 */
export const CAMPOS_SENSIVEIS = {
  salario: "folha.visualizar",
  comissao: "folha.visualizar",
  custo_pessoal: "folha.visualizar",
  preco_cliente: "termos.visualizar",
  saldo_conta: "caixa.visualizar",
  resultado: "dashboard.ver_financeiro",
  margem: "dashboard.ver_financeiro",
  credito_cliente: "creditos.visualizar",
} as const;

export type CampoSensivel = keyof typeof CAMPOS_SENSIVEIS;

/** O usuário pode ver ESTE campo, independentemente da tela em que ele aparece. */
export function canSeeField(
  user: PermissionUser | null | undefined,
  campo: CampoSensivel
): boolean {
  return hasPermission(user, CAMPOS_SENSIVEIS[campo]);
}

/**
 * Valor pronto para a tela: o número, ou o marcador de oculto.
 *
 * Devolve o marcador em vez de zero de propósito — zero é uma informação
 * errada, e uma tela cheia de "R$ 0,00" faz o usuário achar que o sistema
 * perdeu os dados.
 */
export const CAMPO_OCULTO = "•••";

export function maskField<T>(
  user: PermissionUser | null | undefined,
  campo: CampoSensivel,
  valor: T
): T | typeof CAMPO_OCULTO {
  return canSeeField(user, campo) ? valor : CAMPO_OCULTO;
}
