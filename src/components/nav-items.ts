import {
  Home,
  Building2,
  Wallet,
  Handshake,
  Settings2,
  type LucideIcon,
} from "lucide-react";

/**
 * NAVEGAÇÃO POR ESPAÇOS DE TRABALHO — fonte única (barra superior, subnav,
 * barra inferior e gaveta do mobile).
 *
 * B2C Finance 2 (30/08): o produto se organiza nos 4 pilares pedidos pelo
 * dono + o ponto de partida + o sistema:
 *
 *   Hoje       → visão do dia, rotina e assistente
 *   Clientes   → gerir a carteira por completo (carteira + retenção)
 *   Financeiro → gerir o financeiro por completo (mês, inadimplência,
 *                contas, folha, reservas, relatórios) e o HISTÓRICO
 *                mês a mês do ano (pilar "meses anteriores")
 *   Comercial  → upsell, renovações, contratos, serviços e planos
 *   Sistema    → configurações, usuários, regras e importações
 *
 * pages[0] é a página principal do espaço (o clique no nome leva a ela).
 * Rotas fora do menu (/transacoes, /pessoas, /pagamentos, /receitas,
 * /acordos, /cartoes) continuam acessíveis por links contextuais.
 * Visibilidade: cada página exige a permissão de visualizar (RBAC); o
 * espaço some quando nenhuma página dele é visível.
 */

export type NavPage = {
  href: string;
  label: string;
  /** Permissão necessária para a página aparecer (catálogo em lib/permissions). */
  permission: string;
};

export type NavArea = {
  key: string;
  label: string;
  /** Rótulo curto da barra inferior do mobile (fallback: label). */
  short?: string;
  icon: LucideIcon;
  /** Aparece como atalho na barra inferior do mobile. */
  primary?: boolean;
  /** pages[0] = página principal do espaço. */
  pages: NavPage[];
};

export const NAV_AREAS: NavArea[] = [
  {
    key: "hoje",
    label: "Hoje",
    icon: Home,
    primary: true,
    pages: [
      { href: "/dashboard", label: "Visão geral", permission: "dashboard.visualizar" },
      { href: "/rotina", label: "Rotina do dia", permission: "rotina.visualizar" },
      { href: "/rotina/semana", label: "Rotina da semana", permission: "rotina.visualizar" },
      { href: "/assistente", label: "Assistente IA", permission: "assistente.visualizar" },
    ],
  },
  {
    key: "clientes",
    label: "Clientes",
    icon: Building2,
    primary: true,
    pages: [
      { href: "/clientes", label: "Carteira", permission: "clientes.visualizar" },
      { href: "/avaliacoes", label: "Avaliação mensal", permission: "clientes.visualizar" },
      { href: "/retencao", label: "Retenção", permission: "clientes.visualizar" },
    ],
  },
  {
    key: "financeiro",
    label: "Financeiro",
    short: "Fin",
    icon: Wallet,
    primary: true,
    pages: [
      { href: "/cobrancas", label: "Mês (Recebimentos)", permission: "recebimentos.visualizar" },
      { href: "/fila", label: "Modo Fila", permission: "recebimentos.visualizar" },
      { href: "/inadimplencia", label: "Inadimplência", permission: "recebimentos.ver_inadimplencia" },
      { href: "/despesas", label: "Contas a Pagar", permission: "despesas.visualizar" },
      { href: "/folha", label: "Folha", permission: "folha.visualizar" },
      { href: "/fechamento", label: "Fechamento do mês", permission: "fechamento.fechar" },
      { href: "/fechamento/fotografia", label: "Fotografia do mês", permission: "fechamento.fechar" },
      { href: "/projecoes", label: "Histórico Anual", permission: "projecoes.visualizar" },
      { href: "/caixa", label: "Reservas", permission: "caixa.visualizar" },
      { href: "/fluxo", label: "Fluxo de caixa", permission: "caixa.visualizar" },
      { href: "/dre", label: "Resultado (DRE)", permission: "contabil.visualizar" },
      { href: "/impostos", label: "Impostos", permission: "contabil.visualizar" },
      { href: "/rateio", label: "Rateio de mídia", permission: "rateios.visualizar" },
      { href: "/conciliacao", label: "Conciliação bancária", permission: "conciliacao.visualizar" },
      { href: "/comparativo", label: "Comparar meses", permission: "relatorios.visualizar" },
      { href: "/relatorios", label: "Relatórios", permission: "relatorios.visualizar" },
    ],
  },
  {
    key: "comercial",
    label: "Comercial",
    short: "Com",
    icon: Handshake,
    primary: true,
    pages: [
      { href: "/funil", label: "Funil de vendas", permission: "comercial.visualizar" },
      { href: "/atividade", label: "Atividade do dia", permission: "comercial.visualizar" },
      { href: "/funil/closer", label: "Painel do closer", permission: "comercial.visualizar" },
      { href: "/configuracoes/metas", label: "Metas comerciais", permission: "comercial.visualizar" },
      { href: "/funil/leads", label: "Leads", permission: "comercial.visualizar" },
      { href: "/upsell", label: "Upsell", permission: "upsell.visualizar" },
      { href: "/renovacoes", label: "Renovações", permission: "clientes.visualizar" },
      { href: "/contratos", label: "Contratos", permission: "contratos.visualizar" },
      { href: "/servicos", label: "Serviços", permission: "servicos.visualizar" },
      { href: "/ofertas", label: "Planos", permission: "ofertas.visualizar" },
    ],
  },
  {
    key: "sistema",
    label: "Sistema",
    icon: Settings2,
    pages: [
      { href: "/configuracoes", label: "Configurações", permission: "configuracoes.visualizar" },
      { href: "/configuracoes/emails", label: "E-mails do sistema", permission: "configuracoes.visualizar" },
      { href: "/usuarios", label: "Usuários", permission: "usuarios.visualizar" },
      { href: "/regras", label: "Regras de Categoria", permission: "regras.visualizar" },
      { href: "/importacoes", label: "Importar Dados", permission: "importacoes.visualizar" },
    ],
  },
];

/**
 * Usuário "achatado" para a navegação: o layout do servidor calcula o conjunto
 * EFETIVO de permissões (papel + ajustes finos) e passa pronto para os client
 * components — nenhuma lógica de papel espalhada na UI.
 */
export type UserLike = {
  name: string;
  email: string;
  role: string;
  permissions: string[];
} | null;

/** Área com as páginas já filtradas pelas permissões do usuário. */
export type VisibleArea = NavArea & {
  /** Destino do clique na área = primeira página visível. */
  href: string;
  pages: NavPage[];
};

/** Filtra áreas/páginas conforme as permissões efetivas (admin vê tudo). */
export function visibleAreas(user: UserLike): VisibleArea[] {
  if (!user) return [];
  const isAdmin = user.role === "ADMIN";
  const set = new Set(user.permissions);
  const out: VisibleArea[] = [];
  for (const area of NAV_AREAS) {
    const pages = isAdmin
      ? area.pages
      : area.pages.filter((p) => set.has(p.permission));
    if (pages.length === 0) continue;
    out.push({ ...area, pages, href: pages[0].href });
  }
  return out;
}

/** A rota atual pertence a esta área? (prefixo de qualquer página dela) */
export function areaOfPath(areas: VisibleArea[], path: string): VisibleArea | undefined {
  return areas.find((a) =>
    a.pages.some((p) => path === p.href || path.startsWith(p.href + "/"))
  );
}
