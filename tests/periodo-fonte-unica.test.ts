import { describe, it, expect } from "vitest";
import {
  resolvePeriod,
  periodOfPreset,
  periodOfMonth,
  periodLabel,
  presetRange,
  PERIODO_LEGADO,
  PRESET_LABEL,
} from "@/lib/period";

/**
 * RP-01 e DA-04 — auditoria de 11/09/2026.
 *
 * RP-01: /relatorios/financeiro-mensal?periodo=ano mostrava "Este ano" no
 * subtítulo e "Este mês: 1 de set … 11 de set" no controle, na mesma tela.
 * Eram duas fontes de estado: o servidor lia `?periodo=` e o seletor só
 * conhecia `?date=`, caindo no padrão "este mês" e anunciando isso.
 *
 * DA-04: setembro em curso era comparado com agosto inteiro, e o gráfico
 * anual incluía meses futuros sem distinguir realizado de projetado.
 */

// 11/09/2026 — o dia exato da sessão inspecionada.
const DIA_DA_AUDITORIA = new Date(2026, 8, 11);

describe("RP-01 — ?periodo= e o seletor leem a MESMA tabela", () => {
  it("?periodo=ano resolve o ano inteiro, não o mês", () => {
    const p = resolvePeriod({ periodo: "ano" }, DIA_DA_AUDITORIA);
    expect(p.label).toBe("Este ano");
    expect(p.start).toEqual(new Date(2026, 0, 1));
    expect(p.end).toEqual(new Date(2027, 0, 1)); // exclusivo
    // E tem preset equivalente — é isso que o seletor exibe.
    expect(p.preset).toBe("this_year");
    expect(PRESET_LABEL[p.preset]).toBe("Este ano");
  });

  it("todo ?periodo= legado tem preset, e os dois concordam no intervalo", () => {
    for (const [legado, preset] of Object.entries(PERIODO_LEGADO)) {
      const doServidor = resolvePeriod({ periodo: legado }, DIA_DA_AUDITORIA);
      const doSeletor = presetRange(preset, undefined, DIA_DA_AUDITORIA);

      expect(doServidor.preset).toBe(preset);
      expect(doServidor.start).toEqual(doSeletor.start);
      // O Period guarda o fim EXCLUSIVO; o seletor, o inclusivo.
      const fimInclusivo = new Date(doServidor.end);
      fimInclusivo.setDate(fimInclusivo.getDate() - 1);
      expect(fimInclusivo).toEqual(doSeletor.end);
      // E o rótulo é o mesmo dos dois lados — era a divergência visível.
      expect(doServidor.label).toBe(PRESET_LABEL[preset]);
    }
  });

  it("?date= continua mandando quando está presente", () => {
    const p = resolvePeriod(
      { date: "2026-03-01_2026-03-31", preset: "custom", periodo: "ano" },
      DIA_DA_AUDITORIA
    );
    expect(p.start).toEqual(new Date(2026, 2, 1));
    expect(p.end).toEqual(new Date(2026, 3, 1));
  });

  it("sem nenhum parâmetro, o padrão é este mês — nos dois lados", () => {
    const p = resolvePeriod({}, DIA_DA_AUDITORIA);
    expect(p.preset).toBe("this_month");
    expect(p.label).toBe("Este mês");
  });
});

describe("DA-04 — período em curso se declara parcial", () => {
  it("'Este ano' em 11/09 é parcial e diz até onde vai o dado", () => {
    const p = resolvePeriod({ periodo: "ano" }, DIA_DA_AUDITORIA);
    expect(p.parcial).toBe(true);
    expect(p.decorridoAte).toEqual(DIA_DA_AUDITORIA);
    expect(periodLabel(p)).toBe("Este ano · parcial até 11/09");
  });

  it("'Este mês' em curso também é parcial", () => {
    const p = periodOfPreset("this_month", DIA_DA_AUDITORIA);
    expect(p.parcial).toBe(true);
    expect(periodLabel(p)).toBe("Este mês · parcial até 11/09");
  });

  it("período FECHADO não recebe ressalva — só o que ainda corre", () => {
    const passado = periodOfPreset("last_month", DIA_DA_AUDITORIA);
    expect(passado.parcial).toBe(false);
    expect(periodLabel(passado)).toBe("Mês passado");

    const anoPassado = periodOfPreset("last_year", DIA_DA_AUDITORIA);
    expect(anoPassado.parcial).toBe(false);
    expect(periodLabel(anoPassado)).toBe("Ano passado");
  });

  it("mês de competência sabe se é o corrente", () => {
    expect(periodOfMonth(2026, 9, DIA_DA_AUDITORIA).parcial).toBe(true);
    expect(periodOfMonth(2026, 8, DIA_DA_AUDITORIA).parcial).toBe(false);
    expect(periodOfMonth(2026, 12, DIA_DA_AUDITORIA).parcial).toBe(false);
  });

  it("'Últimos 30 dias' termina hoje: não é parcial, está completo", () => {
    const p = periodOfPreset("last_30_days", DIA_DA_AUDITORIA);
    expect(p.parcial).toBe(false);
  });
});

describe("os intervalos batem com o calendário", () => {
  it("este trimestre, em 11/09, é jul–set", () => {
    const r = presetRange("this_quarter", undefined, DIA_DA_AUDITORIA);
    expect(r.start).toEqual(new Date(2026, 6, 1));
    expect(r.end).toEqual(new Date(2026, 8, 30));
  });

  it("este ano vai de 01/01 a 31/12", () => {
    const r = presetRange("this_year", undefined, DIA_DA_AUDITORIA);
    expect(r.start).toEqual(new Date(2026, 0, 1));
    expect(r.end).toEqual(new Date(2026, 11, 31));
  });

  it("mês passado respeita mês curto (março → fevereiro)", () => {
    const r = presetRange("last_month", undefined, new Date(2026, 2, 15));
    expect(r.start).toEqual(new Date(2026, 1, 1));
    expect(r.end).toEqual(new Date(2026, 1, 28));
  });
});

/**
 * PARIDADE COM A RESOLUÇÃO ANTIGA.
 *
 * Unificar a tabela de períodos mexeu no módulo que decide o intervalo de
 * TODA tela financeira. Um deslize de um dia aqui muda faturamento, recebido
 * e resultado sem que nenhuma tela reclame. Por isso a reimplementação antiga
 * fica registrada e comparada dia a dia.
 */
function resolucaoAntiga(periodo: string, now: Date): [Date, Date] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (periodo) {
    case "hoje": {
      const e = new Date(today);
      e.setDate(e.getDate() + 1);
      return [today, e];
    }
    case "trimestre": {
      const q = Math.floor(now.getMonth() / 3);
      return [new Date(now.getFullYear(), q * 3, 1), new Date(now.getFullYear(), q * 3 + 3, 1)];
    }
    case "ano":
      return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)];
    default:
      return [
        new Date(now.getFullYear(), now.getMonth(), 1),
        new Date(now.getFullYear(), now.getMonth() + 1, 1),
      ];
  }
}

describe("a unificação não moveu nenhum intervalo financeiro", () => {
  it("hoje, mês, trimestre e ano batem em todos os dias de 2026", () => {
    const divergencias: string[] = [];
    for (let d = 0; d < 365; d++) {
      const hoje = new Date(2026, 0, 1 + d);
      for (const periodo of ["hoje", "mes", "trimestre", "ano"]) {
        const [inicio, fim] = resolucaoAntiga(periodo, hoje);
        const novo = resolvePeriod({ periodo }, hoje);
        if (+inicio !== +novo.start || +fim !== +novo.end) {
          divergencias.push(`${hoje.toDateString()} ${periodo}`);
        }
      }
    }
    expect(divergencias).toEqual([]);
  });

  it("a semana MUDOU de propósito: domingo → segunda", () => {
    // O servidor abria a semana no DOMINGO; o seletor de datas e a rotina
    // semanal sempre usaram SEGUNDA e dizem isso em comentário. Era mais uma
    // instância da RP-01, e a unificação escolheu a convenção do produto.
    const quarta = new Date(2026, 8, 9); // quarta-feira
    const p = resolvePeriod({ periodo: "semana" }, quarta);
    expect(p.start.getDay()).toBe(1); // segunda
    expect(p.start).toEqual(new Date(2026, 8, 7));
    expect(p.end).toEqual(new Date(2026, 8, 14)); // exclusivo: segunda seguinte
  });
});

describe("hoje do negócio — fuso da Bahia, não o do servidor (25/09/2026)", () => {
  it("23:30 de 30/09 na Bahia (02:30 UTC de 01/10) ainda é setembro", async () => {
    const { hojeDoNegocio, periodOfPreset } = await import("@/lib/period");
    const ref = new Date("2026-10-01T02:30:00.000Z");
    const hj = hojeDoNegocio(ref);
    expect([hj.getFullYear(), hj.getMonth() + 1, hj.getDate()]).toEqual([2026, 9, 30]);
    const p = periodOfPreset("this_month", hj);
    expect(p.start.getMonth() + 1).toBe(9);
    expect(p.end.getMonth() + 1).toBe(10);
    expect(p.end.getDate()).toBe(1);
  });
});
