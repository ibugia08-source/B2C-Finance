import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { CATALOGO } from "@/lib/catalogo";

/**
 * T6 — o catálogo NO CI (02 §245).
 *
 * "Componente novo entra no catálogo com os 5 estados documentados." Este
 * teste é a trava: os componentes canônicos que a spec NOMEIA têm de estar
 * na lista, cada entrada tem EXATAMENTE 5 estados — um por nome do conjunto
 * fechado — e o arquivo apontado existe (catálogo de componente morto é
 * documentação mentirosa).
 */

const CANONICOS_DA_SPEC = [
  "KPI único",
  "MobileCards",
  "AlertDialog",
  "EmptyState",
  "PageHeader",
  "undo-toast",
  "status-meta",
  "MonthNav",
  "Tabela responsiva",
  "SavedView",
];

const NOMES_DE_ESTADO = ["padrão", "vazio", "carregando", "erro/atenção", "desabilitado/limite"];

describe("T6 — catálogo de componentes", () => {
  it("todo componente canônico de 02 §245 está no catálogo", () => {
    for (const nome of CANONICOS_DA_SPEC) {
      expect(
        CATALOGO.some((c) => c.componente.includes(nome)),
        `faltando no catálogo: ${nome}`
      ).toBe(true);
    }
  });

  it("cada entrada tem EXATAMENTE os 5 estados, um de cada nome, todos descritos", () => {
    for (const c of CATALOGO) {
      expect(c.estados, c.componente).toHaveLength(5);
      const nomes = c.estados.map((e) => e.nome);
      expect(new Set(nomes).size, `${c.componente}: estado repetido`).toBe(5);
      for (const n of NOMES_DE_ESTADO) {
        expect(nomes, `${c.componente}: sem o estado "${n}"`).toContain(n);
      }
      for (const e of c.estados) {
        expect(
          e.descricao.trim().length,
          `${c.componente} · ${e.nome}: descrição vazia`
        ).toBeGreaterThan(15);
      }
    }
  });

  it("o arquivo apontado por cada entrada EXISTE — catálogo não aponta para componente morto", () => {
    for (const c of CATALOGO) {
      expect(existsSync(c.arquivo), `${c.componente}: ${c.arquivo} não existe`).toBe(true);
    }
  });
});
