import {
  LayoutDashboard,
  CalendarCheck2,
  CalendarRange,
  Settings2,
  Wand2,
  ArrowUpFromLine,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  Building2,
  FileSignature,
  Package,
  FileBarChart2,
  FileUp,
  Layers,
  LineChart,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /** Seção da sidebar (agrupamento visual). */
  section?: string;
  /** Rótulo curto usado na barra inferior do mobile (fallback: label). */
  short?: string;
  icon: LucideIcon;
  /** Permissão necessária para o item aparecer (catálogo em lib/permissions). */
  permission: string;
  /** Aparece como atalho na barra inferior do mobile. */
  primary?: boolean;
};

// Fonte única de navegação — usada pela sidebar (desktop), pela barra inferior e pela gaveta "Mais" (mobile).
// Estrutura no modelo da planilha do dono: a GESTÃO DO MÊS (antiga tela de
// Recebimentos) é a central de trabalho, logo abaixo do Dashboard; o restante
// se agrupa em OPERAÇÃO / COMERCIAL / ANÁLISE / SISTEMA.
// Receita Extra saiu do menu: virou a seção "Outras Entradas" da Gestão do Mês
// (a rota /receitas continua acessível como histórico completo).
// Movimentações (/transacoes), Pessoas (/pessoas) e Pagamentos (/pagamentos)
// estão fora da navegação — rotas e lógica compartilhada permanecem.
// Visibilidade: cada item exige a permissão de visualizar do módulo (RBAC).
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Início", icon: LayoutDashboard, permission: "dashboard.visualizar", primary: true },
  { href: "/cobrancas", label: "Gestão do Mês", short: "Mês", icon: CalendarRange, permission: "recebimentos.visualizar", primary: true },
  { href: "/clientes", label: "Clientes", short: "Clientes", icon: Building2, permission: "clientes.visualizar", primary: true, section: "Operação" },
  { href: "/despesas", label: "Despesas & Cartões", short: "Despesas", icon: ArrowUpFromLine, permission: "despesas.visualizar", primary: true, section: "Operação" },
  { href: "/folha", label: "Folha", icon: UsersRound, permission: "folha.visualizar", section: "Operação" },
  { href: "/rotina", label: "Rotina Diária", short: "Rotina", icon: CalendarCheck2, permission: "rotina.visualizar", section: "Operação" },
  { href: "/contratos", label: "Contratos", icon: FileSignature, permission: "contratos.visualizar", section: "Comercial" },
  { href: "/upsell", label: "Upsell", icon: TrendingUp, permission: "upsell.visualizar", section: "Comercial" },
  { href: "/servicos", label: "Serviços", icon: Package, permission: "servicos.visualizar", section: "Comercial" },
  { href: "/ofertas", label: "Planos (Ofertas)", icon: Layers, permission: "ofertas.visualizar", section: "Comercial" },
  { href: "/projecoes", label: "Painel Anual", icon: LineChart, permission: "projecoes.visualizar", section: "Análise" },
  { href: "/relatorios", label: "Relatórios", icon: FileBarChart2, permission: "relatorios.visualizar", section: "Análise" },
  { href: "/caixa", label: "Reservas (Caixa)", short: "Reservas", icon: PiggyBank, permission: "caixa.visualizar", section: "Análise" },
  { href: "/assistente", label: "Assistente IA", short: "IA", icon: Sparkles, permission: "assistente.visualizar", section: "Análise" },
  { href: "/importacoes", label: "Importar dados", icon: FileUp, permission: "importacoes.visualizar", section: "Sistema" },
  { href: "/regras", label: "Regras de Categoria", short: "Regras", icon: Wand2, permission: "regras.visualizar", section: "Sistema" },
  { href: "/usuarios", label: "Usuários", icon: ShieldCheck, permission: "usuarios.visualizar", section: "Sistema" },
  { href: "/configuracoes", label: "Configurações", icon: Settings2, permission: "configuracoes.visualizar", section: "Sistema" },
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

/** Filtra itens conforme as permissões efetivas do usuário (admin vê tudo). */
export function visibleNavItems(user: UserLike): NavItem[] {
  if (!user) return [];
  if (user.role === "ADMIN") return NAV_ITEMS;
  const set = new Set(user.permissions);
  return NAV_ITEMS.filter((it) => set.has(it.permission));
}
