import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parsePlanilhaTotal, parseCompetenciaFlex, parseStatusPagamento,
} from "@/lib/imports/total/parser";
import { montarModeloXlsx, COLUNAS_CLIENTES, COLUNAS_MENSAL } from "@/lib/imports/total/modelo";

/**
 * F1.11 (v2) — parser do modelo de 3 abas + conversor do formato largo.
 * Tudo puro: nenhum teste aqui toca o banco.
 */

function livro(abas: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [nome, aoa] of Object.entries(abas))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa as any[][]), nome);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const CAB_CLIENTES = [...COLUNAS_CLIENTES];
const CAB_MENSAL = [...COLUNAS_MENSAL];

const clienteAlfa = [
  "Empresa Alfa", "12.345.678/0001-00", "B2C Gestão", "", "", "", "", "", "", "",
  "15/01/2026", "MRR", "2500,00", "", "", "10", "Tráfego", "Maria", "", "Ativo", "", "", "",
];

describe("competência flexível", () => {
  it("aceita os formatos que planilha de verdade usa", () => {
    expect(parseCompetenciaFlex("2026-03")).toBe("2026-03");
    expect(parseCompetenciaFlex("03/2026")).toBe("2026-03");
    expect(parseCompetenciaFlex("mar/2026")).toBe("2026-03");
    expect(parseCompetenciaFlex("MARÇO 2026")).toBe("2026-03");
    expect(parseCompetenciaFlex("ago/26")).toBe("2026-08");
    expect(parseCompetenciaFlex("marco de 2026")).toBe("2026-03");
  });
  it("recusa o que não é competência", () => {
    expect(parseCompetenciaFlex("13/2026")).toBeNull();
    expect(parseCompetenciaFlex("total")).toBeNull();
    expect(parseCompetenciaFlex("")).toBeNull();
  });
});

describe("vocabulário de status_pagamento", () => {
  it("é fechado e tolerante a caixa/acento", () => {
    expect(parseStatusPagamento("PAGO")).toEqual({ tipo: "PAGO" });
    expect(parseStatusPagamento("sem cobrança")).toEqual({ tipo: "SEM_COBRANCA" });
    expect(parseStatusPagamento("Pago em 05/2026")).toEqual({ tipo: "PAGO_EM", ano: 2026, mes: 5 });
    expect(parseStatusPagamento("pago em 5/26")).toEqual({ tipo: "PAGO_EM", ano: 2026, mes: 5 });
    expect(parseStatusPagamento("quitado")).toBeNull();
  });
});

describe("formato longo (canônico)", () => {
  it("lê as 3 abas com tipos e competências certos", () => {
    const buf = livro({
      CLIENTES: [CAB_CLIENTES, clienteAlfa],
      MENSAL: [
        CAB_MENSAL,
        ["2026-01", "12.345.678/0001-00", "2500,00", "Pago", "10/01/2026", "", "Estável", "Ativo", "Baixo", "não", "Maria", ""],
        ["02/2026", "Empresa Alfa", "2500,00", "Pago em 04/2026", "", "", "Crítico", "Pausado", "Alto", "sim", "", "cliente sumiu"],
      ],
      RENOVACOES: [
        ["cliente*", "data*", "modalidade", "valor_mensal", "valor_total", "prazo_meses", "obs"],
        ["12.345.678/0001-00", "01/03/2026", "MRR", "3000,00", "", "", "reajuste"],
      ],
    });
    const r = parsePlanilhaTotal(buf);
    expect(r.erros).toEqual([]);
    expect(r.formato).toBe("longo");
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0].documento).toBe("12345678000100");
    expect(r.clientes[0].dataEntrada.getMonth()).toBe(0);
    expect(r.mensal).toHaveLength(2);
    expect(r.mensal[0].competencia).toBe("2026-01");
    expect(r.mensal[1].clienteRefEhDocumento).toBe(false);
    expect(r.mensal[1].status).toEqual({ tipo: "PAGO_EM", ano: 2026, mes: 4 });
    expect(r.mensal[1].estabilidade).toBe("Crítico");
    expect(r.renovacoes).toHaveLength(1);
    expect(r.renovacoes[0].valorMensal).toBe(3000);
  });

  it("erro por linha aponta aba, linha e campo — e não derruba as demais", () => {
    const buf = livro({
      CLIENTES: [CAB_CLIENTES, clienteAlfa],
      MENSAL: [
        CAB_MENSAL,
        ["2026-01", "12.345.678/0001-00", "", "Quitado", "", "", "", "", "", "", "", ""],
        ["2026-02", "12.345.678/0001-00", "", "Parcial", "", "", "", "", "", "", "", ""],
        ["2026-03", "12.345.678/0001-00", "", "Pago", "", "", "", "", "", "", "", ""],
      ],
    });
    const r = parsePlanilhaTotal(buf);
    expect(r.mensal).toHaveLength(1); // só a linha 3 sobrevive
    expect(r.erros).toHaveLength(2);
    expect(r.erros[0]).toMatchObject({ aba: "MENSAL", linha: 1, campo: "status_pagamento" });
    expect(r.erros[1]).toMatchObject({ linha: 2, campo: "valor_pago" });
  });

  it("MRR sem valor mensal e status fora do vocabulário são recusados na aba CLIENTES", () => {
    const semValor = [...clienteAlfa]; semValor[12] = ""; // valor_mensal
    const statusRuim = [...clienteAlfa]; statusRuim[0] = "Beta"; statusRuim[19] = "Cancelado";
    const buf = livro({ CLIENTES: [CAB_CLIENTES, semValor, statusRuim] });
    const r = parsePlanilhaTotal(buf);
    expect(r.erros.some((e) => e.campo === "valor_mensal")).toBe(true);
    expect(r.erros.some((e) => e.campo === "status_atual" && e.linha === 2)).toBe(true);
  });
});

describe("formato largo", () => {
  it("uma aba por mês vira MENSAL com a competência do nome da aba", () => {
    const cab = ["cliente", "status_pagamento", "valor_cobrado"];
    const buf = livro({
      CLIENTES: [CAB_CLIENTES, clienteAlfa],
      "JAN 2026": [cab, ["12.345.678/0001-00", "Pago", "2500,00"]],
      "FEV 2026": [cab, ["12.345.678/0001-00", "Vencido", ""]],
    });
    const r = parsePlanilhaTotal(buf);
    expect(r.formato).toBe("largo-abas");
    expect(r.mensal.map((m) => m.competencia).sort()).toEqual(["2026-01", "2026-02"]);
    expect(r.mensal.find((m) => m.competencia === "2026-02")?.status.tipo).toBe("VENCIDO");
  });

  it("colunas de meses lado a lado viram MENSAL; célula fora do vocabulário vira erro localizado", () => {
    const buf = livro({
      CLIENTES: [CAB_CLIENTES, clienteAlfa],
      GESTAO: [
        ["cliente", "01/2026", "02/2026", "03/2026"],
        ["12.345.678/0001-00", "Pago", "pago com atraso", "ok"],
      ],
    });
    const r = parsePlanilhaTotal(buf);
    expect(r.formato).toBe("largo-colunas");
    expect(r.mensal).toHaveLength(2);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatchObject({ aba: "GESTAO", campo: "03/2026" });
  });
});

describe("modelo baixável", () => {
  it("o próprio modelo passa no parser sem erros", () => {
    const r = parsePlanilhaTotal(montarModeloXlsx());
    expect(r.erros).toEqual([]);
    expect(r.clientes).toHaveLength(1);
    expect(r.mensal).toHaveLength(3);
    expect(r.renovacoes).toHaveLength(1);
  });
});
