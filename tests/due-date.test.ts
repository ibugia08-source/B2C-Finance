import { describe, it, expect } from "vitest";
import {
  lastDayOfMonth,
  getValidDueDateForMonth,
  addMonthsClamped,
} from "@/lib/financial/due-date";

/**
 * Clamp de calendário — ref. 01 §3.4.
 * Rede de proteção: estes valores não podem mudar no refactor das fases 1+.
 */
const d = (x: Date) =>
  `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;

describe("lastDayOfMonth", () => {
  it("conhece meses de 31, 30 e fevereiro (comum e bissexto)", () => {
    expect(lastDayOfMonth(2026, 1)).toBe(31);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29); // bissexto
    expect(lastDayOfMonth(2000, 2)).toBe(29); // divisível por 400
    expect(lastDayOfMonth(1900, 2)).toBe(28); // divisível por 100, não por 400
  });
});

describe("getValidDueDateForMonth", () => {
  it("mantém o dia quando ele existe no mês", () => {
    expect(d(getValidDueDateForMonth(2026, 3, 15))).toBe("15/03/2026");
  });

  it("clampa para o último dia quando o dia não existe", () => {
    expect(d(getValidDueDateForMonth(2026, 4, 31))).toBe("30/04/2026");
    expect(d(getValidDueDateForMonth(2026, 2, 31))).toBe("28/02/2026");
    expect(d(getValidDueDateForMonth(2028, 2, 30))).toBe("29/02/2028");
  });

  it("usa dia 5 como padrão quando não há dia recorrente", () => {
    expect(d(getValidDueDateForMonth(2026, 7, null))).toBe("05/07/2026");
    expect(d(getValidDueDateForMonth(2026, 7, undefined))).toBe("05/07/2026");
  });

  it("mantém o dia dentro de 1..31 antes de clampar", () => {
    expect(d(getValidDueDateForMonth(2026, 5, 0))).toBe("01/05/2026");
    expect(d(getValidDueDateForMonth(2026, 5, -3))).toBe("01/05/2026");
    expect(d(getValidDueDateForMonth(2026, 5, 99))).toBe("31/05/2026");
  });

  it("devolve meia-noite local (a competência não escorrega de dia)", () => {
    const x = getValidDueDateForMonth(2026, 6, 10);
    expect([x.getHours(), x.getMinutes(), x.getSeconds(), x.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });
});

describe("addMonthsClamped", () => {
  it("31/01 + 1 mês vira 28/02, nunca 03/03", () => {
    expect(d(addMonthsClamped(new Date(2026, 0, 31), 1))).toBe("28/02/2026");
    expect(d(addMonthsClamped(new Date(2028, 0, 31), 1))).toBe("29/02/2028");
  });

  it("31/03 + 1 mês vira 30/04", () => {
    expect(d(addMonthsClamped(new Date(2026, 2, 31), 1))).toBe("30/04/2026");
  });

  it("preserva o dia quando ele existe no mês de destino", () => {
    expect(d(addMonthsClamped(new Date(2026, 0, 15), 12))).toBe("15/01/2027");
    expect(d(addMonthsClamped(new Date(2026, 5, 10), 6))).toBe("10/12/2026");
  });

  it("atravessa a virada do ano", () => {
    expect(d(addMonthsClamped(new Date(2026, 10, 30), 3))).toBe("28/02/2027");
    expect(d(addMonthsClamped(new Date(2026, 11, 31), 1))).toBe("31/01/2027");
  });
});
