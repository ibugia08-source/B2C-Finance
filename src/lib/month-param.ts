/**
 * O parâmetro ?mes=AAAA-MM — fonte única (F1.14).
 *
 * MonthNav, paleta de comandos, atalhos [ e ] e os links da subnav
 * precisam concordar sobre o que é "o mês da tela". Antes cada um
 * remontava a string por conta própria; agora é aqui.
 *
 * Não confundir com lib/competence.ts: aquilo é a COMPETÊNCIA contábil
 * de um fato (01 §3.15); isto é só o estado da navegação na URL.
 */
export const MES_PARAM = "mes";

export type Mes = { year: number; month: number };

const RE = /^(\d{4})-(\d{2})$/;

export function parseMes(valor: string | null | undefined): Mes | null {
  const m = RE.exec((valor ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function formatMes({ year, month }: Mes): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function mesAtual(hoje = new Date()): Mes {
  return { year: hoje.getFullYear(), month: hoje.getMonth() + 1 };
}

/** Desloca N meses, normalizando o transbordo de ano. */
export function shiftMes(base: Mes, delta: number): Mes {
  const d = new Date(base.year, base.month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Lê ?mes= da URL atual (navegador); cai no mês corrente. */
export function mesDaUrl(search: string, hoje = new Date()): Mes {
  return parseMes(new URLSearchParams(search).get(MES_PARAM)) ?? mesAtual(hoje);
}

/**
 * Rotas que vivem por competência — e por isso ganham o MonthNav na barra
 * global (02 §7.5, gabarito "Planilha viva"). Antes cada uma dessas telas
 * renderizava o próprio MonthNav, o que fazia o controle pular de lugar
 * conforme a página. Agora o controle é um só, no mesmo canto, sempre.
 */
export const ROTAS_COM_MES = [
  "/cobrancas",
  "/clientes",
  "/despesas",
  "/folha",
  "/receitas",
  "/renovacoes",
];

export function rotaTemMes(pathname: string): boolean {
  return ROTAS_COM_MES.some((r) => pathname === r || pathname.startsWith(r + "?"));
}

