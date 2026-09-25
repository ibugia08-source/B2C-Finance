import { describe, it, expect } from "vitest";
import { parseBRL } from "@/lib/format";

describe("parseBRL", () => {
  it("formato brasileiro", () => {
    expect(parseBRL("1.500,50")).toBe(1500.5);
    expect(parseBRL("R$ 1.234.567,89")).toBe(1234567.89);
    expect(parseBRL("1500,5")).toBe(1500.5);
    expect(parseBRL("1.500")).toBe(1500);
    expect(parseBRL("1.500.000")).toBe(1500000);
  });
  it("ponto decimal do teclado do celular não multiplica por 100", () => {
    expect(parseBRL("1500.50")).toBe(1500.5);
    expect(parseBRL("99.9")).toBe(99.9);
    expect(parseBRL("1,500.50")).toBe(1500.5);
  });
  it("vazio e lixo viram zero", () => {
    expect(parseBRL("")).toBe(0);
    expect(parseBRL("abc")).toBe(0);
  });
});
