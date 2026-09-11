import type { ReportColumn } from "./shared";

/**
 * GEOMETRIA DO DOCUMENTO IMPRESSO (P0.1 da auditoria de 10/09/2026).
 *
 * A auditoria encontrou nove relatórios perdendo conteúdo no PDF — "a tabela
 * ultrapassa a área imprimível e o lado direito é cortado". A causa não é
 * estética: os PDFs eram a IMPRESSÃO DA TELA, e a tela guarda a tabela dentro
 * de um contêiner com rolagem horizontal. O que rola na tela não rola no
 * papel: some.
 *
 * Este módulo é a decisão de página, tomada ANTES de renderizar e a partir do
 * contrato do relatório (as colunas), não do acaso do conteúdo:
 *
 *   1. estima a largura mínima legível de cada coluna pelo TIPO e pelo
 *      RÓTULO (cabeçalho que não cabe é corte garantido);
 *   2. compara com a área imprimível do A4 retrato;
 *   3. vira para PAISAGEM quando não cabe, e só então aperta a tipografia.
 *
 * A ordem importa: apertar a fonte antes de virar a página é o atalho que
 * produz documento ilegível — a auditoria pede explicitamente que o usuário
 * não precise "reduzir a fonte até ficar ilegível".
 *
 * Tudo em MILÍMETROS porque a unidade do papel é o milímetro; converter para
 * pixel só na hora de medir no navegador (96dpi → 1mm = 3.7795px).
 */

/** A4 em mm (ISO 216). */
export const A4 = { largura: 210, altura: 297 } as const;

/** Margem do documento: 14mm (a auditoria pede 12–16mm). */
export const MARGEM_MM = 14;

export const PX_POR_MM = 96 / 25.4;

export type Orientacao = "retrato" | "paisagem";

/** Área útil de uma página, já descontadas as margens. */
export function areaUtil(orientacao: Orientacao): { largura: number; altura: number } {
  const l = orientacao === "retrato" ? A4.largura : A4.altura;
  const a = orientacao === "retrato" ? A4.altura : A4.largura;
  return { largura: l - 2 * MARGEM_MM, altura: a - 2 * MARGEM_MM };
}

/**
 * LARGURA MÍNIMA por tipo, em mm: abaixo disto a célula fica ilegível.
 *
 * Dinheiro tem largura previsível ("R$ 123.456,78" cabe em 26mm a 9pt).
 * Texto não tem: nome de cliente varia de 6 a 90 caracteres, e é por isso
 * que ele é o único que QUEBRA LINHA em vez de exigir largura — cortar
 * "GAMA ESQUADRIAS E VIDRAÇARIA LTDA" no meio é pior que usar duas linhas.
 */
const MINIMO_POR_TIPO: Record<ReportColumn["kind"], number> = {
  text: 26,
  money: 24,
  int: 16,
  percent: 18,
  date: 22,
};

/**
 * PESO na hora de repartir a largura disponível.
 *
 * Não basta um mínimo por tipo: com dez colunas, repartir igual dá ~27mm
 * para cada uma, e aí um nome longo quebra UMA PALAVRA POR LINHA — a célula
 * vira um parágrafo vertical, a linha fica com oito linhas de altura e 130
 * clientes viram catorze páginas. O peso resolve isso dizendo QUEM CRESCE
 * quando sobra espaço: o texto cresce, o dinheiro não precisa.
 */
const PESO_POR_TIPO: Record<ReportColumn["kind"], number> = {
  text: 1,
  money: 0.72,
  int: 0.45,
  percent: 0.5,
  date: 0.62,
};

/**
 * A PRIMEIRA coluna de texto é a IDENTIDADE da linha (cliente, descrição,
 * contrato) e recebe peso extra: é o campo que a pessoa lê para saber de
 * quem é a linha, e o único em que quebrar em muitas linhas atrapalha a
 * leitura da tabela inteira.
 */
const PESO_DA_IDENTIDADE = 3;

/** Largura por caractere do rótulo a 9pt, com folga de respiro. */
const MM_POR_CARACTERE = 1.75;
const FOLGA_DO_ROTULO = 6;

/**
 * Largura MÍNIMA de uma coluna: o maior entre o mínimo do tipo e a MAIOR
 * PALAVRA do rótulo.
 *
 * A maior palavra, e não o rótulo inteiro, por duas razões que se somam:
 *
 *  - o cabeçalho PODE quebrar entre palavras ("Contratos / ativos" em duas
 *    linhas é legível e economiza 14mm de largura por coluna);
 *  - o cabeçalho NÃO PODE quebrar dentro da palavra. Com a coluna estreita
 *    demais, "Vencimento" virava "Vencimen / to" — e um cabeçalho partido
 *    ao meio some do texto do PDF, que foi exatamente como o verificador
 *    pegou este defeito.
 */
export function larguraDaColuna(col: ReportColumn): number {
  const doTipo = MINIMO_POR_TIPO[col.kind] ?? MINIMO_POR_TIPO.text;
  const maiorPalavra = col.label
    .split(/\s+/)
    .reduce((m, palavra) => Math.max(m, palavra.length), 0);
  const doRotulo = maiorPalavra * MM_POR_CARACTERE + FOLGA_DO_ROTULO;
  return Math.max(doTipo, doRotulo);
}

export function larguraEstimada(columns: ReportColumn[]): number {
  return columns.reduce((s, c) => s + larguraDaColuna(c), 0);
}

/** Pesos de repartição, com a identidade da linha puxando mais. */
function pesos(columns: ReportColumn[]): number[] {
  const primeiroTexto = columns.findIndex((c) => c.kind === "text");
  return columns.map((c, i) => {
    const base = PESO_POR_TIPO[c.kind] ?? 1;
    return i === primeiroTexto ? base * PESO_DA_IDENTIDADE : base;
  });
}

export type PlanoDePagina = {
  orientacao: Orientacao;
  /** Área útil em mm, já sem margens. */
  area: { largura: number; altura: number };
  /** Corpo da tabela em pt — cai só depois de a paisagem não bastar. */
  fonteDaTabela: number;
  larguraEstimada: number;
  /** Nem a paisagem comporta: a tela avisa em vez de cortar calado. */
  apertado: boolean;
  /** Percentual de largura por coluna, para o colgroup (soma 100). */
  colunas: { key: string; percentual: number }[];
};

/** Fontes em pt, na ordem em que são tentadas. */
const FONTE_PADRAO = 9;
const FONTE_APERTADA = 8;
/** Abaixo disto vira ilegível no papel — a auditoria é explícita. */
const FONTE_MINIMA = 7.5;

/**
 * Decide orientação, fonte e largura de cada coluna.
 *
 * `apertado` não é falha: é a declaração honesta de que o relatório tem
 * colunas demais para uma folha. Quem lê o documento vê o aviso; quem lê o
 * script de verificação vê o relatório na lista de atenção. O que NÃO
 * acontece é a coluna sumir sem ninguém saber.
 */
export function planejarPagina(columns: ReportColumn[]): PlanoDePagina {
  const estimada = larguraEstimada(columns);
  const retrato = areaUtil("retrato");
  const paisagem = areaUtil("paisagem");

  let orientacao: Orientacao = "retrato";
  let fonte = FONTE_PADRAO;
  let apertado = false;

  if (estimada > retrato.largura) {
    orientacao = "paisagem";
    if (estimada > paisagem.largura) {
      // A fonte menor encolhe a largura exigida na mesma proporção.
      fonte = FONTE_APERTADA;
      const encolhida = estimada * (FONTE_APERTADA / FONTE_PADRAO);
      if (encolhida > paisagem.largura) {
        fonte = FONTE_MINIMA;
        apertado = estimada * (FONTE_MINIMA / FONTE_PADRAO) > paisagem.largura;
      }
    }
  }

  const area = areaUtil(orientacao);

  // REPARTIÇÃO: cada coluna recebe pelo menos o seu mínimo; o que sobra é
  // dividido por peso. Quando nem os mínimos cabem (relatório apertado), a
  // largura cai proporcionalmente ao peso — ninguém some, todo mundo aperta
  // junto, e o aviso de `apertado` diz isso na cara do documento.
  const minimos = columns.map((c) => larguraDaColuna(c));
  const p = pesos(columns);
  const somaPesos = p.reduce((s2, x) => s2 + x, 0) || 1;
  const sobra = area.largura - estimada;
  const larguras = minimos.map((min, i) =>
    sobra > 0 ? min + (sobra * p[i]) / somaPesos : min
  );

  const total = larguras.reduce((s2, l) => s2 + l, 0) || 1;
  const colunas = columns.map((c, i) => ({
    key: c.key,
    percentual: Math.round((larguras[i] / total) * 10000) / 100,
  }));

  return {
    orientacao,
    area,
    fonteDaTabela: fonte,
    larguraEstimada: estimada,
    apertado,
    colunas,
  };
}

/**
 * Nome do arquivo pedido pela auditoria:
 * `b2c-finance_inadimplencia_posicao-2026-09-10.pdf`.
 *
 * O nome é parte da integridade: um diretório com dezoito "documento.pdf" faz
 * a pessoa abrir os dezoito para achar um. O recorte entra no nome porque o
 * mesmo relatório em dois períodos são dois arquivos diferentes.
 */
export function nomeDoArquivo(relatorio: string, recorte: string): string {
  const limpo = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `b2c-finance_${limpo(relatorio)}_${limpo(recorte)}`;
}
