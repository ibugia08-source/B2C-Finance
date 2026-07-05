import {
  LayoutDashboard,
  CalendarCheck2,
  Receipt,
  Landmark,
  Users,
  Settings2,
  Wand2,
  ArrowDownToLine,
  ArrowUpFromLine,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  MessageCircle,
  Building2,
  FileSignature,
  Package,
  HandCoins,
  BarChart3,
  FileBarChart2,
  FileUp,
  Scale,
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
  { href: "/rotina", label: "Rotina do dia", short: "Rotina", icon: CalendarCheck2, adminOnly: true },

  { section: "Agência", href: "/clientes", label: "Clientes", icon: Building2, adminOnly: true },
  { section: "Agência", href: "/contratos", label: "Contratos", icon: FileSignature, adminOnly: true },
  { section: "Agência", href: "/cobrancas", label: "Cobranças", icon: HandCoins, adminOnly: true },
  { section: "Agência", href: "/financeiro", label: "Financeiro", icon: BarChart3, adminOnly: true },
  { section: "Agência", href: "/folha", label: "Folha", icon: UsersRound, adminOnly: true },
  { section: "Agência", href: "/ativos", label: "Patrimônio", icon: Scale, adminOnly: true },
  { section: "Agência", href: "/servicos", label: "Serviços & Planos", icon: Package, adminOnly: true },

  { section: "Análises", href: "/relatorios", label: "Relatórios", icon: FileBarChart2, adminOnly: true },
  { section: "Análises", href: "/importacoes", label: "Importar dados", icon: FileUp, adminOnly: true },
  { section: "Análises", href: "/assistente", label: "Assistente IA", icon: Sparkles },
  { section: "Análises", href: "/whatsapp", label: "Agente IA", icon: MessageCircle, adminOnly: true },

  { section: "Meu financeiro", href: "/receitas", label: "Receitas", icon: ArrowDownToLine, primary: true },
  { section: "Meu financeiro", href: "/despesas", label: "Despesas", icon: ArrowUpFromLine },
  { section: "Meu financeiro", href: "/caixa", label: "Caixa", icon: PiggyBank, primary: true },
  { section: "Meu financeiro", href: "/transacoes", label: "Movimentações", short: "Mov.", icon: Receipt, primary: true },
  { section: "Meu financeiro", href: "/cartoes", label: "Contas bancárias", short: "Cartões", icon: Landmark },
  { section: "Meu financeiro", href: "/pessoas", label: "Contatos & dívidas", short: "Contatos", icon: Users },
  { section: "Meu financeiro", href: "/regras", label: "Regras", icon: Wand2 },

  { section: "Sistema", href: "/usuarios", label: "Usuários", icon: ShieldCheck, adminOnly: true },
  { section: "Sistema", href: "/configuracoes", label: "Configurações", icon: Settings2, adminOnly: true },
];

export type UserLike = { name: string; email: string; role: "ADMIN" | "USER" } | null;

/** Filtra itens conforme o papel do usuário (admin vê tudo). */
export function visibleNavItems(user: UserLike): NavItem[] {
  return NAV_ITEMS.filter((it) => !it.adminOnly || user?.role === "ADMIN");
}
