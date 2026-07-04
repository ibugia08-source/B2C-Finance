import {
  LayoutDashboard,
  Receipt,
  Upload,
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
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
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
  { href: "/assistente", label: "Assistente IA", icon: Sparkles },
  { href: "/whatsapp", label: "Agente IA", icon: MessageCircle, adminOnly: true },
  { href: "/receitas", label: "Receitas", icon: ArrowDownToLine, primary: true },
  { href: "/despesas", label: "Despesas", icon: ArrowUpFromLine },
  { href: "/caixa", label: "Caixa", icon: PiggyBank, primary: true },
  { href: "/transacoes", label: "Movimentações", short: "Mov.", icon: Receipt, primary: true },
  { href: "/importar", label: "Importar fatura", short: "Importar", icon: Upload },
  { href: "/cartoes", label: "Contas bancárias", short: "Cartões", icon: Landmark },
  { href: "/pessoas", label: "Pessoas", icon: Users },
  { href: "/regras", label: "Regras", icon: Wand2 },
  { href: "/usuarios", label: "Usuários", icon: ShieldCheck, adminOnly: true },
  { href: "/configuracoes", label: "Configurações", icon: Settings2, adminOnly: true },
];

export type UserLike = { name: string; email: string; role: "ADMIN" | "USER" } | null;

/** Filtra itens conforme o papel do usuário (admin vê tudo). */
export function visibleNavItems(user: UserLike): NavItem[] {
  return NAV_ITEMS.filter((it) => !it.adminOnly || user?.role === "ADMIN");
}
