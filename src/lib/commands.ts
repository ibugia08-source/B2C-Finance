import { NAV_AREAS, type UserLike } from "@/components/nav-items";

/**
 * REGISTRO DE COMANDOS (F1.14 · ref. 02 §3).
 *
 * Fonte única da paleta (Ctrl/Cmd+K), do mapa de atalhos (?) e dos
 * atalhos globais. O mapa de atalhos é "gerado do registro real de
 * comandos", como a spec exige — não existe lista escrita à mão em
 * lugar nenhum, então ele nunca mente sobre o que o sistema faz.
 *
 * REGRA que segurei de propósito: só entra comando que FUNCIONA hoje.
 * "Fechar competência" (F2.1), "comparar março x julho" (F2.5) e
 * "exportar DRE" (F3.2) estão na spec como exemplos, mas as telas ainda
 * não existem — registrá-los agora encheria a paleta de becos sem saída.
 * Eles entram quando as fases deles entrarem.
 */

export type CommandAction =
  | "mesAnterior"
  | "mesSeguinte"
  | "mesAtual"
  | "alternarTema"
  | "mapaDeAtalhos";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group: "Ir para" | "Ações" | "Período" | "Exibição";
  /** Permissão necessária; ausente = todo mundo. */
  permission?: string;
  /** Termos extras que casam na busca (sem acento, minúsculo). */
  keywords?: string;
  href?: string;
  action?: CommandAction;
  /** Sequência de teclas (ex.: "g m") ou tecla única (ex.: "["). */
  shortcut?: string;
};

/** Ações e período — o que a paleta faz além de navegar. */
const FIXOS: Command[] = [
  { id: "cliente.novo", label: "Novo cliente", group: "Ações", permission: "clientes.criar",
    href: "/clientes?novo=1", keywords: "cadastrar adicionar carteira" },
  { id: "despesa.nova", label: "Nova despesa", group: "Ações", permission: "despesas.criar",
    href: "/despesas?nova=1", keywords: "conta pagar gasto lancar" },
  { id: "cobranca.gerar", label: "Gerar cobranças do mês", group: "Ações",
    permission: "recebimentos.gerar_cobranca", href: "/cobrancas", keywords: "mensalidade faturar" },
  { id: "pagamento.registrar", label: "Registrar pagamento", group: "Ações",
    permission: "recebimentos.registrar_pagamento", href: "/cobrancas",
    keywords: "receber baixa quitar pagar" },

  { id: "mes.anterior", label: "Mês anterior", group: "Período", action: "mesAnterior", shortcut: "[" },
  { id: "mes.seguinte", label: "Mês seguinte", group: "Período", action: "mesSeguinte", shortcut: "]" },
  { id: "mes.atual", label: "Ir para o mês atual", group: "Período", action: "mesAtual",
    keywords: "hoje agora" },

  { id: "tema.alternar", label: "Alternar tema claro/escuro", group: "Exibição", action: "alternarTema",
    keywords: "dark light noturno aparencia" },
  { id: "atalhos.mapa", label: "Mapa de atalhos", group: "Exibição", action: "mapaDeAtalhos",
    shortcut: "?", keywords: "teclado ajuda" },
];

/** Atalhos de navegação exigidos por 02 §3. */
const ATALHO_POR_ROTA: Record<string, string> = {
  "/cobrancas": "g m", // Gestão do Mês
  "/clientes": "g c",  // Carteira
  "/inadimplencia": "g r", // Receber
};

/** Todos os comandos que ESTE usuário pode executar. */
export function visibleCommands(user: UserLike): Command[] {
  if (!user) return [];
  const isAdmin = user.role === "ADMIN";
  const set = new Set(user.permissions);
  const pode = (p?: string) => !p || isAdmin || set.has(p);

  const navegacao: Command[] = NAV_AREAS.flatMap((area) =>
    area.pages.map((p) => ({
      id: `ir.${p.href}`,
      label: p.label,
      hint: area.label,
      group: "Ir para" as const,
      permission: p.permission,
      href: p.href,
      shortcut: ATALHO_POR_ROTA[p.href],
    }))
  );

  return [...navegacao, ...FIXOS].filter((c) => pode(c.permission));
}

/** Normaliza para busca: sem acento, minúsculo. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Filtra por termo, casando rótulo, dica e palavras-chave. */
export function filterCommands(cmds: Command[], termo: string): Command[] {
  const q = normalize(termo.trim());
  if (!q) return cmds;
  return cmds.filter((c) =>
    normalize(`${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`).includes(q)
  );
}

/** Comandos com atalho, para o mapa gerado do registro real. */
export function shortcutMap(cmds: Command[]): Command[] {
  return cmds.filter((c) => c.shortcut);
}
