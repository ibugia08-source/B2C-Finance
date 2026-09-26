import { describe, it, expect } from "vitest";
import {
  statusAtDate, statusForCompetence, nextScheduledChange, validateTimeline, classifyEffectiveDate,
  suggestedEffectiveFrom, describeInterval, StatusTimelineConflictError, type StatusInterval,
} from "@/lib/clients/status-history";
import {
  addDays, civilDateKeyOf, competenceReferenceDate, getCompetenceKey, getEndOfCompetence,
  getNextCompetence, getPreviousCompetence, getStartOfCompetence, isDateKey, todayKey,
} from "@/lib/competence";

/**
 * STATUS COM VIGÊNCIA — regras PURAS (26/09/2026). Sem banco: a regra
 * temporal lida, discutida e testada isolada. Datas fixas do pedido do dono
 * (hoje 26/09/2026; Inativo a partir de 01/10/2026; perda em 16/10...).
 */

let seq = 0;
function i(status: StatusInterval["status"], from: string, to: string | null): StatusInterval {
  return {
    id: `i${++seq}`, clientId: "alpha", status, from, to, reason: null, origin: "USUARIO",
    needsReview: false, changedById: null, createdAt: new Date(),
  };
}

const HOJE = "2026-09-26";

describe("helpers de competência", () => {
  it("início e fim da competência — 28, 29, 30 e 31 dias", () => {
    expect(getStartOfCompetence("2026-09")).toBe("2026-09-01");
    expect(getEndOfCompetence("2026-09")).toBe("2026-09-30"); // 30 dias
    expect(getEndOfCompetence("2026-10")).toBe("2026-10-31"); // 31 dias
    expect(getEndOfCompetence("2026-02")).toBe("2026-02-28"); // 28 dias
    expect(getEndOfCompetence("2024-02")).toBe("2024-02-29"); // bissexto
    expect(getEndOfCompetence("2100-02")).toBe("2100-02-28"); // secular não bissexto
  });

  it("competência anterior/seguinte atravessa o ano", () => {
    expect(getPreviousCompetence("2026-01")).toBe("2025-12");
    expect(getNextCompetence("2026-12")).toBe("2027-01");
    expect(getCompetenceKey("2026-10-15")).toBe("2026-10");
    expect(getCompetenceKey(2026, 9)).toBe("2026-09");
  });

  it("dia civil: validação e soma sem fuso", () => {
    expect(isDateKey("2024-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("01/10/2026 não vira 30/09/2026 por conversão UTC ↔ Bahia", () => {
    // 01/10 00:30 na Bahia = 03:30Z do mesmo dia; 30/09 23:30 na Bahia = 02:30Z de 01/10.
    expect(todayKey(new Date("2026-10-01T03:30:00Z"))).toBe("2026-10-01");
    expect(todayKey(new Date("2026-10-01T02:30:00Z"))).toBe("2026-09-30");
    // Data civil gravada à meia-noite UTC (legado) lê o dia UTC.
    expect(civilDateKeyOf(new Date("2026-10-01T00:00:00.000Z"))).toBe("2026-10-01");
    // Data civil gravada ao meio-dia da Bahia (15:00Z) também.
    expect(civilDateKeyOf(new Date("2026-10-01T15:00:00.000Z"))).toBe("2026-10-01");
  });

  it("referência da competência: passado = último dia; em curso = hoje; futuro = último dia", () => {
    expect(competenceReferenceDate("2026-08", HOJE)).toBe("2026-08-31");
    expect(competenceReferenceDate("2026-09", HOJE)).toBe(HOJE);
    expect(competenceReferenceDate("2026-10", HOJE)).toBe("2026-10-31");
  });
});

describe("getClientStatusAtDate (regra pura)", () => {
  const t = [i("ACTIVE", "2026-01-10", "2026-09-30"), i("INACTIVE", "2026-10-01", null)];

  it("início e fim exatos da vigência", () => {
    expect(statusAtDate(t, "2026-01-10")).toBe("ACTIVE"); // primeiro dia
    expect(statusAtDate(t, "2026-09-30")).toBe("ACTIVE"); // último dia
    expect(statusAtDate(t, "2026-10-01")).toBe("INACTIVE"); // virada
  });

  it("ausência de status: antes da entrada não há status (não é 'inativo', é nada)", () => {
    expect(statusAtDate(t, "2026-01-09")).toBeNull();
    expect(statusAtDate([], "2026-05-01")).toBeNull();
  });

  it("conflito de intervalos: dois status no mesmo dia lança — nunca escolhe um em silêncio", () => {
    const ruim = [i("ACTIVE", "2026-01-01", null), i("PAUSED", "2026-05-01", null)];
    expect(() => statusAtDate(ruim, "2026-06-01")).toThrow(StatusTimelineConflictError);
    expect(validateTimeline(ruim)).toContainEqual(expect.stringContaining("sobrepostos"));
  });

  it("fim antes do começo é inválido", () => {
    expect(validateTimeline([i("ACTIVE", "2026-05-10", "2026-05-01")])).toContainEqual(
      expect.stringContaining("Fim antes do começo")
    );
    expect(validateTimeline(t)).toEqual([]);
  });
});

describe("getClientStatusForCompetence (regra pura)", () => {
  it("REGRESSÃO: Inativo a partir de outubro não reescreve setembro", () => {
    const t = [i("ACTIVE", "2026-01-10", "2026-09-30"), i("INACTIVE", "2026-10-01", null)];
    expect(statusForCompetence(t, "2026-09", HOJE)).toBe("ACTIVE");
    expect(statusForCompetence(t, "2026-10", HOJE)).toBe("INACTIVE");
    expect(statusForCompetence(t, "2026-09", HOJE)).not.toBe("INACTIVE");
  });

  it("mudança futura: hoje 26/09 ainda é Ativo; setembro Ativo; outubro Inativo", () => {
    const t = [i("ACTIVE", "2026-01-01", "2026-09-30"), i("INACTIVE", "2026-10-01", null)];
    expect(statusAtDate(t, HOJE)).toBe("ACTIVE"); // status atual
    expect(statusForCompetence(t, "2026-09", HOJE)).toBe("ACTIVE");
    expect(statusForCompetence(t, "2026-10", HOJE)).toBe("INACTIVE");
    expect(nextScheduledChange(t, HOJE)?.from).toBe("2026-10-01");
  });

  it("reativação: Ativo jan–set, Inativo out, Ativo nov em diante", () => {
    const t = [
      i("ACTIVE", "2026-01-01", "2026-09-30"),
      i("INACTIVE", "2026-10-01", "2026-10-31"),
      i("ACTIVE", "2026-11-01", null),
    ];
    expect(statusForCompetence(t, "2026-08", HOJE)).toBe("ACTIVE");
    expect(statusForCompetence(t, "2026-09", HOJE)).toBe("ACTIVE");
    expect(statusForCompetence(t, "2026-10", HOJE)).toBe("INACTIVE");
    expect(statusForCompetence(t, "2026-11", HOJE)).toBe("ACTIVE");
    expect(statusForCompetence(t, "2026-12", HOJE)).toBe("ACTIVE");
  });

  it("perdido no meio do mês: Ativo até 15/10, Perdido desde 16/10 — outubro fecha Perdido", () => {
    const t = [i("ACTIVE", "2026-01-01", "2026-10-15"), i("CHURNED", "2026-10-16", null)];
    const depois = "2026-11-05";
    expect(statusForCompetence(t, "2026-09", depois)).toBe("ACTIVE");
    expect(statusForCompetence(t, "2026-10", depois)).toBe("CHURNED");
    expect(statusAtDate(t, "2026-10-15")).toBe("ACTIVE"); // a mudança real fica registrada na data
  });

  it("pausado tem vigência como qualquer status", () => {
    const t = [
      i("ACTIVE", "2026-01-01", "2026-08-31"),
      i("PAUSED", "2026-09-01", "2026-09-30"),
      i("INACTIVE", "2026-10-01", null),
    ];
    expect(statusForCompetence(t, "2026-08", "2026-12-01")).toBe("ACTIVE");
    expect(statusForCompetence(t, "2026-09", "2026-12-01")).toBe("PAUSED");
    expect(statusForCompetence(t, "2026-10", "2026-12-01")).toBe("INACTIVE");
  });

  it("fevereiro bissexto usa 29/02 como encerramento", () => {
    const t = [i("ACTIVE", "2024-01-01", "2024-02-28"), i("CHURNED", "2024-02-29", null)];
    expect(statusForCompetence(t, "2024-02", "2024-06-01")).toBe("CHURNED");
    const t2 = [i("ACTIVE", "2023-01-01", "2023-02-27"), i("CHURNED", "2023-02-28", null)];
    expect(statusForCompetence(t2, "2023-02", "2023-06-01")).toBe("CHURNED");
  });
});

describe("classificação da vigência e sugestão da interface", () => {
  it("retroativa (mês passado), da competência atual e futura", () => {
    expect(classifyEffectiveDate("2026-08-31", HOJE)).toBe("RETROATIVA");
    expect(classifyEffectiveDate("2026-09-01", HOJE)).toBe("COMPETENCIA_ATUAL");
    expect(classifyEffectiveDate(HOJE, HOJE)).toBe("COMPETENCIA_ATUAL");
    expect(classifyEffectiveDate("2026-09-27", HOJE)).toBe("FUTURA");
    expect(classifyEffectiveDate("2026-10-01", HOJE)).toBe("FUTURA");
  });

  it("olhando outubro, sugere 01/10; na competência em curso, hoje", () => {
    expect(suggestedEffectiveFrom("2026-10", HOJE)).toBe("2026-10-01");
    expect(suggestedEffectiveFrom("2026-09", HOJE)).toBe(HOJE);
    expect(describeInterval({ from: "2026-10-01", to: null })).toBe("a partir de 01/10/2026");
    expect(describeInterval({ from: "2026-01-10", to: "2026-09-30" })).toBe("10/01/2026 até 30/09/2026");
  });
});
