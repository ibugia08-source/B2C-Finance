import { describe, expect, it } from "vitest";
import {
  areaUtil, larguraDaColuna, larguraEstimada, nomeDoArquivo, planejarPagina,
} from "@/lib/reports/print-layout";
import { REPORTS } from "@/lib/reports/registry";
import type { ReportColumn } from "@/lib/reports/shared";

/**
 * P0.1 — a geometria do documento impresso.
 *
 * A auditoria de 10/09/2026 achou nove relatórios perdendo o lado direito da
 * tabela no PDF. A verificação de ponta a ponta (scripts/verificar-pdfs.mjs)
 * gera os arquivos e lê o texto de dentro deles; estes testes guardam a
 * DECISÃO que vem antes disso e que não depende de navegador: quanta largura
 * cada coluna exige e quando a página tem de virar.
 *
 * O que eles impedem de voltar, item a item do achado:
 *  - relatório largo renderizado em retrato (a origem do corte);
 *  - coluna cuja largura mínima não cabe o cabeçalho — rótulo partido no
 *    meio da palavra some da leitura E do texto extraído do PDF;
 *  - fonte reduzida antes de tentar a paisagem (documento ilegível).
 */

const col = (label: string, kind: ReportColumn["kind"] = "text"): ReportColumn => ({
  key: label.toLowerCase().replace(/\s+/g, "-"),
  label,
  kind,
});

describe("P0.1 — largura de coluna", () => {
  it("a coluna cabe a MAIOR PALAVRA do rótulo, não o rótulo inteiro", () => {
    // "Contratos ativos" pode quebrar entre as duas palavras; "Vencimento",
    // não pode quebrar em lugar nenhum.
    const duasPalavras = larguraDaColuna(col("Contratos ativos", "int"));
    const umaPalavra = larguraDaColuna(col("Vencimento", "date"));
    expect(duasPalavras).toBeLessThan("Contratos ativos".length * 1.75 + 6);
    expect(umaPalavra).toBeGreaterThanOrEqual("Vencimento".length * 1.75 + 6);
  });

  it("dinheiro tem largura previsível e independe do tamanho do rótulo", () => {
    expect(larguraDaColuna(col("Valor", "money"))).toBe(
      larguraDaColuna(col("Total", "money"))
    );
  });
});

describe("P0.1 — decisão de página", () => {
  it("relatório estreito fica em RETRATO", () => {
    const plano = planejarPagina([col("Grupo"), col("Indicador"), col("Valor", "money")]);
    expect(plano.orientacao).toBe("retrato");
    expect(plano.fonteDaTabela).toBe(9);
  });

  it("relatório largo vira PAISAGEM antes de encolher a fonte", () => {
    const largo = Array.from({ length: 10 }, (_, i) => col(`Coluna ${i}`, "money"));
    const plano = planejarPagina(largo);
    expect(plano.orientacao).toBe("paisagem");
    // A ordem importa: virar a página primeiro, apertar a letra depois. Um
    // documento em retrato com fonte 7,5pt é o atalho que a auditoria proíbe.
    expect(plano.fonteDaTabela).toBe(9);
  });

  it("quando nem a paisagem comporta, o documento DECLARA que está apertado", () => {
    const absurdo = Array.from({ length: 24 }, (_, i) => col(`Indicador ${i}`, "money"));
    const plano = planejarPagina(absurdo);
    expect(plano.orientacao).toBe("paisagem");
    expect(plano.fonteDaTabela).toBeLessThan(9);
    expect(plano.apertado).toBe(true);
    // Declarar é o oposto de esconder: nenhuma coluna sai da lista.
    expect(plano.colunas).toHaveLength(24);
  });

  it("as larguras somam 100% — nenhuma coluna fica de fora do papel", () => {
    for (const def of REPORTS) {
      const plano = planejarPagina(def.columns);
      const soma = plano.colunas.reduce((s, c) => s + c.percentual, 0);
      expect(Math.abs(soma - 100), `${def.key}: soma ${soma}%`).toBeLessThan(0.5);
      expect(plano.colunas.map((c) => c.key)).toEqual(def.columns.map((c) => c.key));
    }
  });

  it("a sobra de largura vai para o TEXTO, que é quem quebra linha", () => {
    const plano = planejarPagina([col("Cliente"), col("Valor", "money")]);
    const cliente = plano.colunas.find((c) => c.key === "cliente")!;
    const valor = plano.colunas.find((c) => c.key === "valor")!;
    expect(cliente.percentual).toBeGreaterThan(valor.percentual * 2);
  });

  it("TODO relatório do catálogo cabe na página que o plano escolhe", () => {
    // A régua é o próprio contrato: soma dos mínimos ≤ área útil escolhida.
    // Quem não cabe tem de sair marcado como apertado, nunca cortado.
    for (const def of REPORTS) {
      const plano = planejarPagina(def.columns);
      const area = areaUtil(plano.orientacao);
      const minima = larguraEstimada(def.columns) * (plano.fonteDaTabela / 9);
      if (!plano.apertado) {
        expect(minima, `${def.key} não cabe em ${plano.orientacao}`).toBeLessThanOrEqual(
          area.largura + 0.01
        );
      }
    }
  });
});

describe("P0.1 — nome do arquivo", () => {
  it("segue o padrão da auditoria, sem acento e sem espaço", () => {
    expect(nomeDoArquivo("Inadimplência", "posição 2026-09-10")).toBe(
      "b2c-finance_inadimplencia_posicao-2026-09-10"
    );
  });

  it("dois recortes do mesmo relatório dão nomes diferentes", () => {
    expect(nomeDoArquivo("Clientes", "01/09/2026-a-30/09/2026")).not.toBe(
      nomeDoArquivo("Clientes", "01/08/2026-a-31/08/2026")
    );
  });
});
