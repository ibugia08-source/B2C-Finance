import {
  LayoutDashboard,
  CalendarRange,
  Settings2,
  ArrowUpFromLine,
  Building2,
  LineChart,
  type LucideIcon,
} from "lucide-react";

/**
 * NAVEGAÇÃO POR ÁREAS — fonte única (sidebar desktop, barra inferior e
 * gaveta "Mais" do mobile).
 *
 * Reconstrução de 29/08: o menu plano de 20 itens virou 6 ÁREAS com
 * subpáginas — a pessoa decide entre 6 conceitos, não 20 telas:
 *
 *   Início        → visão geral + rotina do dia
 *   Gestão do Mês → planilha mensal de recebimentos + inadimplência
 *   Clientes      → carteira, retenção, renovações, upsell, contratos
 *   Despesas      → contas a pagar + folha
 *   Análise       → painel anual, relatórios, reservas, assistente
 *   Sistema       → configurações, usuários, catálogo, regras, importações
 *
 * pages[0] é a página principal da área (o clique na área leva a ela).
 * Rotas fora do menu (/transacoes, /pessoas, /pagamentos, /receitas,
 * /acordos, /cartoes) continuam acessíveis por links contextuais.
 * Visibilidade: cada página exige a permissão de visualizar (RBAC); a
 * área some quando nenhuma página dela é visível.
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
  /** pages[0] = página principal da área. */
  pages: NavPage[];
};

export const NAV_AREAS: NavArea[] = [
  {
    key: "inicio",
    label: "Início",
    icon: LayoutDashboard,
    primary: true,
    pages: [
      { href: "/dashboard", label: "Visão geral", permission: "dashboard.visualizar" },
      { href: "/rotina", label: "Rotina do dia", permission: "rotina.visualizar" },
    ],
  },
  {
    key: "mes",
    label: "Gestão do Mês",
    short: "Mês",
    icon: CalendarRange,
    primary: true,
    pages: [
      { href: "/cobrancas", label: "Recebimentos", permission: "recebimentos.visualizar" },
      { href: "/inadimplencia", label: "Inadimplência", permission: "recebimentos.ver_inadimplencia" },
    ],
  },
  {
    key: "clientes",
    label: "Clientes",
    icon: Building2,
    primary: true,
    pages: [
      { href: "/clientes", label: "Carteira", permission: "clientes.visualizar" },
      { href: "/retencao", label: "Retenção", permission: "clientes.visualizar" },
      { href: "/renovacoes", label: "Renovações", permission: "clientes.visualizar" },
      { href: "/upsell", label: "Upsell", permission: "upsell.visualizar" },
      { href: "/contratos", label: "Contratos", permission: "contratos.visualizar" },
    ],
  },
  {
    key: "despesas",
    label: "Despesas",
    icon: ArrowUpFromLine,
    primary: true,
    pages: [
      { href: "/despesas", label: "Contas a Pagar", permission: "despesas.visualizar" },
      { href: "/folha", label: "Folha de Pagamento", permission: "folha.visualizar" },
    ],
  },
  {
    key: "analise",
    label: "Análise",
    icon: LineChart,
    pages: [
      { href: "/projecoes", label: "Painel Anual", permission: "projecoes.visualizar" },
      { href: "/relatorios", label: "Relatórios", permission: "relatorios.visualizar" },
      { href: "/caixa", label: "Reservas (Caixa)", permission: "caixa.visualizar" },
      { href: "/assistente", label: "Assistente IA", permission: "assistente.visualizar" },
    ],
  },
  {
    key: "sistema",
    label: "Sistema",
    icon: Settings2,
    pages: [
      { href: "/configuracoes", label: "Configurações", permission: "configuracoes.visualizar" },
      { href: "/usuarios", label: "Usuários", permission: "usuarios.visualizar" },
      { href: "/servicos", label: "Catálogo de Serviços", permission: "servicos.visualizar" },
      { href: "/ofertas", label: "Planos (Ofertas)", permission: "ofertas.visualizar" },
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
