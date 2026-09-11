import { describe, it, expect } from "vitest";
import {
  formatDateBR,
  formatInstantBR,
  formatInstantTimeBR,
  formatDateInput,
} from "@/lib/format";

/**
 * DATA CIVIL × INSTANTE DE EVENTO — DA-03 da auditoria de 11/09/2026.
 *
 * O defeito: a MESMA renovação aparecia como 29/09 na ficha do cliente e
 * 30/09 no contrato e no módulo Renovações. Causa: `formatDateBR` formatava
 * no fuso do leitor. O servidor da Vercel roda em UTC (acertava) e o
 * navegador do usuário roda em São Paulo, UTC−3 (voltava um dia), porque a
 * data civil fica ancorada em meia-noite UTC.
 *
 * Este arquivo é a rede que impede a volta: a data civil precisa sair IGUAL
 * em qualquer fuso, e o instante de evento precisa continuar seguindo o fuso
 * do workspace — que é o comportamento certo para ele.
 */

/** Roda um trecho com o fuso do processo trocado. */
function comFuso<T>(tz: string, fn: () => T): T {
  const anterior = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = anterior;
  }
}

// A renovação exata que a auditoria flagrou.
const RENOVACAO = new Date("2026-09-30T00:00:00.000Z");

describe("data civil (vencimento, renovação, início de contrato)", () => {
  it("sai igual em UTC e em São Paulo — a divergência 29/09 × 30/09 não volta", () => {
    const utc = comFuso("UTC", () => formatDateBR(RENOVACAO));
    const sp = comFuso("America/Sao_Paulo", () => formatDateBR(RENOVACAO));
    const bahia = comFuso("America/Bahia", () => formatDateBR(RENOVACAO));
    const tokyo = comFuso("Asia/Tokyo", () => formatDateBR(RENOVACAO));

    expect(utc).toBe("30/09/2026");
    expect(sp).toBe("30/09/2026");
    expect(bahia).toBe("30/09/2026");
    // Fuso à FRENTE de UTC também não pode empurrar para 01/10.
    expect(tokyo).toBe("30/09/2026");
  });

  it("aceita string ISO e Date com o mesmo resultado", () => {
    expect(formatDateBR("2026-09-30T00:00:00.000Z")).toBe("30/09/2026");
    expect(formatDateBR(RENOVACAO)).toBe("30/09/2026");
  });

  it("a cobrança que a auditoria viu como 07/09 e 08/09 sai só como 08/09", () => {
    const vencimento = new Date("2026-09-08T00:00:00.000Z");
    for (const tz of ["UTC", "America/Sao_Paulo", "America/Bahia", "Europe/Lisbon"]) {
      expect(comFuso(tz, () => formatDateBR(vencimento))).toBe("08/09/2026");
    }
  });

  it("concorda com o valor que vai para o <input type=date>", () => {
    // Tela e formulário de edição precisam mostrar o MESMO dia.
    expect(formatDateInput(RENOVACAO)).toBe("2026-09-30");
    expect(formatDateBR(RENOVACAO)).toBe("30/09/2026");
  });

  it("vazio e data inválida não viram texto quebrado", () => {
    expect(formatDateBR(null)).toBe("");
    expect(formatDateBR(undefined)).toBe("");
    expect(formatDateBR("não é data")).toBe("");
  });

  it("atravessa a virada do mês sem escorregar", () => {
    expect(formatDateBR(new Date("2026-01-01T00:00:00.000Z"))).toBe("01/01/2026");
    expect(formatDateBR(new Date("2026-12-31T00:00:00.000Z"))).toBe("31/12/2026");
    expect(formatDateBR(new Date("2028-02-29T00:00:00.000Z"))).toBe("29/02/2028");
  });
});

describe("instante de evento (createdAt, generatedAt, markedAt)", () => {
  it("usa o fuso do workspace: 23h em Salvador é o dia 10, não o dia 11", () => {
    // 11/09 às 02:00 UTC = 10/09 às 23:00 em America/Bahia (UTC−3).
    const gravadoEm = new Date("2026-09-11T02:00:00.000Z");
    expect(formatInstantBR(gravadoEm)).toBe("10/09/2026");
    expect(formatInstantTimeBR(gravadoEm)).toContain("10/09/2026");
    expect(formatInstantTimeBR(gravadoEm)).toContain("23:00");
  });

  it("independe do fuso do PROCESSO — segue sempre o do workspace", () => {
    const gravadoEm = new Date("2026-09-11T02:00:00.000Z");
    for (const tz of ["UTC", "Asia/Tokyo", "America/Sao_Paulo"]) {
      expect(comFuso(tz, () => formatInstantBR(gravadoEm))).toBe("10/09/2026");
    }
  });

  it("vazio e inválido também são silenciosos", () => {
    expect(formatInstantBR(null)).toBe("");
    expect(formatInstantTimeBR(undefined)).toBe("");
  });
});
