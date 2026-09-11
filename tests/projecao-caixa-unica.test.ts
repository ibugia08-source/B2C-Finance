import { describe, it, expect } from "vitest";
import * as fs from "fs";

/**
 * DA-01 — "projeção 30 dias" tinha DOIS valores na mesma tela.
 *
 * A auditoria de 11/09/2026 mediu −R$ 107.643,06 no card de Liquidez e
 * −R$ 26.548,53 no bloco "Atenção hoje". Os dois liam "projeção de 30 dias".
 *
 * A correção foi estrutural: existe UMA função, `projecaoDeCaixa`, e as duas
 * chamadas leem dela. Este teste guarda a estrutura — se alguém voltar a
 * escrever a conta à mão em qualquer um dos dois lugares, ele reprova antes
 * de a divergência chegar à tela.
 */

const liquidity = fs.readFileSync("src/lib/services/liquidity.ts", "utf8");
const finance = fs.readFileSync("src/lib/services/finance-metrics.ts", "utf8");

describe("projeção de caixa tem fonte única", () => {
  it("liquidity.ts exporta a função canônica", () => {
    expect(liquidity).toContain("export async function projecaoDeCaixa");
  });

  it("finance-metrics NÃO refaz a conta — delega", () => {
    expect(finance).toContain('import { projecaoDeCaixa } from "./liquidity"');
    // A assinatura antiga recebia o caixa de partida e somava por conta própria.
    expect(finance).not.toContain("projecao(caixaDisponivel");
    // Nenhuma agregação de billing dentro da projeção deste arquivo.
    const corpoProjecao = finance.slice(
      finance.indexOf("async function projecao("),
      finance.indexOf("async function getCashSummaryImpl")
    );
    expect(corpoProjecao).not.toContain("prisma.billing.aggregate");
    expect(corpoProjecao).not.toContain("prisma.liability.aggregate");
  });

  it("getLiquidez não recalcula a projeção de 30 dias", () => {
    // A soma antiga: disponivel + entradas30d − saidas30d.
    expect(liquidity).not.toContain("centavo(disponivel + entradas30d - saidas30d)");
    expect(liquidity).toContain("projecao30d: proj.projecao");
  });

  it("o vencido fica fora da soma e é reportado à parte", () => {
    // Era contar o atrasado como entrada garantida que deixava um dos dois
    // números otimista demais.
    expect(liquidity).toContain("aReceberVencido");
    const corpo = liquidity.slice(
      liquidity.indexOf("export async function projecaoDeCaixa"),
      liquidity.indexOf("export const getLiquidez")
    );
    expect(corpo).toContain("partida + entradas - saidas - financiado");
    expect(corpo).not.toContain("entradasVencidas +");
  });
});
