import {
  LayoutDashboard,
  CalendarCheck2,
  Receipt,
  Users,
  Settings2,
  Wand2,
  ArrowDownToLine,
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
  adminOnly?: boolean;
  /** Aparece como atalho na barra inferior do mobile. */
  primary?: boolean;
};

// Fonte única de navegação — usada pela sidebar (desktop), pela barra inferior e pela gaveta "Mais" (mobile).
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Início", icon: LayoutDashboard, primary: true },
  { href: "/rotina", label: "Rotina diária", short: "Rotina", icon: CalendarCheck2, adminOnly: true },

  { section: "Agência", href: "/clientes", label: "Clientes", short: "Clientes", icon: Building2, adminOnly: true, primary: true },
  { section: "Agência", href: "/contratos", label: "Contratos", icon: FileSignature, adminOnly: true },
  { section: "Agência", href: "/folha", label: "Folha", icon: UsersRound, adminOnly: true },
  { section: "Agência", href: "/servicos", label: "Serviços", icon: Package, adminOnly: true },
  { section: "Agência", href: "/ofertas", label: "Planos (Ofertas)", icon: Layers, adminOnly: true },
  { section: "Agência", href: "/upsell", label: "Upsell", icon: TrendingUp, adminOnly: true },

  // Financeiro da agência (contas/cartões vivem DENTRO de Despesas)
  { section: "Financeiro", href: "/receitas", label: "Receitas extras", short: "Receitas", icon: ArrowDownToLine, adminOnly: true, primary: true },
  { section: "Financeiro", href: "/despesas", label: "Despesas", icon: ArrowUpFromLine, adminOnly: true },
  { section: "Financeiro", href: "/transacoes", label: "Movimentações", short: "Mov.", icon: Receipt, adminOnly: true, primary: true },
  { section: "Financeiro", href: "/caixa", label: "Reservas (caixa)", short: "Reservas", icon: PiggyBank, adminOnly: true },
  { section: "Financeiro", href: "/pessoas", label: "Pessoas & reembolsos", short: "Pessoas", icon: Users, adminOnly: true },
  { section: "Financeiro", href: "/regras", label: "Regras de categoria", short: "Regras", icon: Wand2, adminOnly: true },

  { section: "Análises", href: "/relatorios", label: "Relatórios", icon: FileBarChart2, adminOnly: true },
  { section: "Análises", href: "/projecoes", label: "Projeções", icon: LineChart, adminOnly: true },
  { section: "Análises", href: "/importacoes", label: "Importar dados", icon: FileUp, adminOnly: true },
  { section: "Análises", href: "/assistente", label: "Assistente IA", icon: Sparkles },

  { section: "Sistema", href: "/usuarios", label: "Usuários", icon: ShieldCheck, adminOnly: true },
  { section: "Sistema", href: "/configuracoes", label: "Configurações", icon: Settings2, adminOnly: true },
];

export type UserLike = { name: string; email: string; role: "ADMIN" | "USER" } | null;

/** Filtra itens conforme o papel do usuário (admin vê tudo). */
export function visibleNavItems(user: UserLike): NavItem[] {
  return NAV_ITEMS.filter((it) => !it.adminOnly || user?.role === "ADMIN");
}
