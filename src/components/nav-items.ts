import {
  LayoutDashboard,
  CalendarCheck2,
  Receipt,
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
  /** Permissão necessária para o item aparecer (catálogo em lib/permissions). */
  permission: string;
  /** Aparece como atalho na barra inferior do mobile. */
  primary?: boolean;
};

// Fonte única de navegação — usada pela sidebar (desktop), pela barra inferior e pela gaveta "Mais" (mobile).
// Ordem FIXA definida pelo usuário (sem seções/agrupamentos):
// Dashboard → Clientes → Recebimentos → Despesas → Folha → Receita Extra →
// Rotina Diária → Assistente IA → Relatórios → Projeções → Reservas (Caixa) →
// Serviços → Planos (Ofertas) → Upsell → Contratos → Regras de Categoria →
// Importar dados → Usuários → Configurações.
// Movimentações (/transacoes) e Pessoas & reembolsos (/pessoas) foram retirados
// da navegação — as rotas e a lógica compartilhada permanecem no sistema.
// Visibilidade: cada item exige a permissão de visualizar do módulo (RBAC).
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Início", icon: LayoutDashboard, permission: "dashboard.visualizar", primary: true },
  { href: "/clientes", label: "Clientes", short: "Clientes", icon: Building2, permission: "clientes.visualizar", primary: true },
  { href: "/cobrancas", label: "Recebimentos", short: "Receb.", icon: Receipt, permission: "recebimentos.visualizar", primary: true },
  { href: "/despesas", label: "Despesas", icon: ArrowUpFromLine, permission: "despesas.visualizar" },
  { href: "/folha", label: "Folha", icon: UsersRound, permission: "folha.visualizar" },
  { href: "/receitas", label: "Receita Extra", short: "Receitas", icon: ArrowDownToLine, permission: "receitas.visualizar", primary: true },
  { href: "/rotina", label: "Rotina Diária", short: "Rotina", icon: CalendarCheck2, permission: "rotina.visualizar" },
  { href: "/assistente", label: "Assistente IA", short: "IA", icon: Sparkles, permission: "assistente.visualizar" },
  { href: "/relatorios", label: "Relatórios", icon: FileBarChart2, permission: "relatorios.visualizar" },
  { href: "/projecoes", label: "Projeções", icon: LineChart, permission: "projecoes.visualizar" },
  { href: "/caixa", label: "Reservas (Caixa)", short: "Reservas", icon: PiggyBank, permission: "caixa.visualizar" },
  { href: "/servicos", label: "Serviços", icon: Package, permission: "servicos.visualizar" },
  { href: "/ofertas", label: "Planos (Ofertas)", icon: Layers, permission: "ofertas.visualizar" },
  { href: "/upsell", label: "Upsell", icon: TrendingUp, permission: "upsell.visualizar" },
  { href: "/contratos", label: "Contratos", icon: FileSignature, permission: "contratos.visualizar" },
  { href: "/regras", label: "Regras de Categoria", short: "Regras", icon: Wand2, permission: "regras.visualizar" },
  { href: "/importacoes", label: "Importar dados", icon: FileUp, permission: "importacoes.visualizar" },
  { href: "/usuarios", label: "Usuários", icon: ShieldCheck, permission: "usuarios.visualizar" },
  { href: "/configuracoes", label: "Configurações", icon: Settings2, permission: "configuracoes.visualizar" },
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
