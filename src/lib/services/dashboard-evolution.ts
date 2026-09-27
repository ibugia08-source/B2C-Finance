import { prisma } from "@/lib/prisma";
import { toNumber as n, MONTHS_PT_SHORT } from "@/lib/format";
import { addMonths, toCompetence, todayKey, type Competence } from "@/lib/competence";
import { getActiveClientsByCompetences } from "@/lib/clients/status-history";
import { lossValue } from "./revenue-metrics";

/**
 * SÉRIES DE EVOLUÇÃO DA VISÃO GERAL (26/09/2026, pedido do dono).
 *
 *  · MRR × TCV — janela móvel de 12 meses terminando no mês em foco (a tela
 *    filtra 3/6/12 sem nova consulta). MRR = mensalidade dos clientes MRR
 *    ATIVOS no encerramento de cada competência (linha do tempo de status,
 *    mesma regra do card); TCV = cobranças TCV da competência (valor cheio).
 *  · Clientes ativos, churn (qtd + R$ perdido) — Jan..Dez do ano em foco.
 *    Clientes = ativos no encerramento de cada mês; churn = perdas
 *    registradas (ClientLoss) no mês, mesma fonte do card. Meses que ainda
 *    não aconteceram ficam nulos (não é projeção).
 *
 * Tudo em lote: uma consulta de status para as duas janelas, uma de
 * cobranças TCV, uma de perdas.
 */

export type MrrTcvPoint = { competence: Competence; label: string; mrr: number; tcv: number };
export type YearPoint = { label: string; ativos: number | null; churn: number | null; churnValue: number | null };

const rotulo = (c: Competence, comAno: boolean) => {
  const m = Number(c.slice(5, 7));
  return comAno ? `${MONTHS_PT_SHORT[m - 1]}/${c.slice(2, 4)}` : MONTHS_PT_SHORT[m - 1];
};

export async function getDashboardEvolution(opts: {
  anchor: Competence;
  year: number;
  today?: string;
}): Promise<{ mrrTcv: MrrTcvPoint[]; year: YearPoint[] }> {
  const today = opts.today ?? todayKey();
  const atual = today.slice(0, 7);
  const janela = Array.from({ length: 12 }, (_, i) => addMonths(opts.anchor, i - 11));
  const doAno = Array.from({ length: 12 }, (_, i) => toCompetence(opts.year, i + 1));
  const todas = Array.from(new Set([...janela, ...doAno]));

  const [clientes, ativosPor, tcvRows, perdas] = await Promise.all([
    prisma.client.findMany({ select: { id: true, modality: true, monthlyValue: true } }),
    getActiveClientsByCompetences(todas, { today }),
    prisma.billing.findMany({
      where: {
        revenueType: "TCV",
        status: { not: "CANCELED" },
        OR: janela.map((c) => ({ competenceYear: +c.slice(0, 4), competenceMonth: +c.slice(5, 7) })),
      },
      select: { amount: true, competenceYear: true, competenceMonth: true },
    }),
    prisma.clientLoss.findMany({
      where: { lostAt: { gte: new Date(opts.year, 0, 1), lt: new Date(opts.year + 1, 0, 1) } },
      select: { lostAt: true, modality: true, monthlyValue: true, referenceValue: true },
    }),
  ]);

  const mensal = new Map(clientes.filter((c) => c.modality === "MRR").map((c) => [c.id, n(c.monthlyValue)]));
  const tcvPor = new Map<string, number>();
  for (const b of tcvRows) {
    const c = toCompetence(b.competenceYear, b.competenceMonth);
    tcvPor.set(c, (tcvPor.get(c) ?? 0) + n(b.amount));
  }
  const cruzaAno = janela[0].slice(0, 4) !== janela[11].slice(0, 4);
  const mrrTcv = janela.map((c) => {
    let mrr = 0;
    for (const id of ativosPor.get(c) ?? []) mrr += mensal.get(id) ?? 0;
    return {
      competence: c,
      label: rotulo(c, cruzaAno),
      mrr: Math.round(mrr * 100) / 100,
      tcv: Math.round((tcvPor.get(c) ?? 0) * 100) / 100,
    };
  });

  const churnPor = new Map<number, { count: number; value: number }>();
  for (const l of perdas) {
    const m = l.lostAt.getMonth();
    const cur = churnPor.get(m) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += lossValue(l);
    churnPor.set(m, cur);
  }
  const year = doAno.map((c, i) => {
    const futuro = c > atual;
    const ch = churnPor.get(i);
    return {
      label: MONTHS_PT_SHORT[i],
      ativos: futuro ? null : ativosPor.get(c)?.size ?? 0,
      churn: futuro ? null : ch?.count ?? 0,
      churnValue: futuro ? null : Math.round((ch?.value ?? 0) * 100) / 100,
    };
  });
  return { mrrTcv, year };
}
