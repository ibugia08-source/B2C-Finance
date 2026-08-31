import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { METRIC_REGISTRY_VERSION } from "@/lib/metrics/registry";
import { computePeriodMetrics } from "@/lib/metrics/engine";
import { toNumber as n } from "@/lib/format";
import { checksumByArea, money } from "./serialize";
import type { Competence } from "@/lib/competence";

/**
 * MOTOR DE FOTOGRAFIA (F2.3 · ref. 01 §5.4).
 *
 * Grava por ÁREA, com metadados que respondem "com que régua isto foi
 * medido": versão do formato, versão do dicionário de métricas e o instante
 * de corte da leitura.
 *
 * O `sourceCutoffAt` é o metadado mais importante e o mais fácil de tratar
 * como enfeite. Ele é o que permite, meses depois, RECALCULAR o mês lendo os
 * fatos até aquele instante e comparar com o que está gravado. Sem ele, a
 * conferência periódica compararia o passado congelado com o presente vivo e
 * acusaria divergência sempre.
 *
 * ÁREAS de §5.4 que ainda não têm fonte (funil, rateio, conciliação) NÃO
 * entram como objeto vazio: entram declarando que não existiam nesta fase.
 * Uma área vazia dentro de uma fotografia é indistinguível de uma área que
 * zerou — e essa confusão só aparece meses depois, quando é tarde.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

export type AreaNaoDisponivel = { indisponivel: true; motivo: string };

const indisponivel = (motivo: string): AreaNaoDisponivel => ({ indisponivel: true, motivo });

export type ConteudoSnapshot = Record<string, unknown>;

/** Lê a realidade do mês e devolve o conteúdo por área, já normalizado. */
export async function montarAreas(competence: Competence | string): Promise<ConteudoSnapshot> {
  const [ano, mes] = competence.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, 1);
  const fim = new Date(ano, mes, 1);

  const [relacoes, termos, cobrancas, despesas, contas, reservas, folha, avaliacoes, metricas] =
    await Promise.all([
      prisma.clientAgencyRelationship.findMany({
        where: { lifecycleStatus: { in: ["ACTIVE", "ONBOARDING", "PAUSED"] } },
        orderBy: { id: "asc" },
        select: {
          id: true, clientId: true, lifecycleStatus: true, financialStatus: true,
          agencyId: true, startedAt: true,
          client: { select: { name: true } },
        },
      }),
      prisma.commercialTerm.findMany({
        where: { validTo: null },
        orderBy: { id: "asc" },
        select: {
          id: true, relationshipId: true, modality: true, monthlyValue: true,
          totalContractValue: true, contractMonths: true, validFrom: true,
        },
      }),
      prisma.billing.findMany({
        where: { competence },
        orderBy: { id: "asc" },
        select: {
          id: true, clientId: true, relationshipId: true, amount: true, paidTotal: true,
          status: true, dueDate: true, billingKind: true, recognitionMode: true,
        },
      }),
      prisma.transaction.findMany({
        where: { type: "despesa", date: { gte: inicio, lt: fim } },
        orderBy: { id: "asc" },
        select: { id: true, amount: true, status: true, categoryId: true, date: true },
      }),
      prisma.account.findMany({
        where: { active: true },
        orderBy: { id: "asc" },
        select: { id: true, name: true, balance: true, type: true },
      }),
      prisma.cashBox.findMany({
        orderBy: { id: "asc" },
        select: { id: true, name: true, currentAmount: true, targetAmount: true },
      }),
      prisma.payroll.findMany({
        where: { year: ano, month: mes },
        orderBy: { id: "asc" },
        select: {
          id: true, status: true, paidAt: true,
          items: { orderBy: { id: "asc" }, select: { id: true, employeeId: true, amount: true } },
        },
      }),
      prisma.avaliacaoMensal.findMany({
        where: { competence },
        orderBy: { id: "asc" },
        select: {
          id: true, relationshipId: true, estabilidade: true, ads: true,
          risco: true, upsell: true, confirmedAt: true,
        },
      }),
      computePeriodMetrics({ start: inicio, end: fim } as any),
    ]);

  // AGING do que estava em aberto no corte — a foto de §5.4 pede
  // "receber + aging", e recalcular aging depois daria outro número, porque
  // "vencido há quantos dias" depende de QUANDO se pergunta.
  const corte = new Date();
  const faixa = (dias: number) =>
    dias <= 15 ? "1-15" : dias <= 30 ? "16-30" : dias <= 60 ? "31-60" : "60+";
  const aging: Record<string, { qtd: number; valor: string }> = {
    "1-15": { qtd: 0, valor: "0.00" },
    "16-30": { qtd: 0, valor: "0.00" },
    "31-60": { qtd: 0, valor: "0.00" },
    "60+": { qtd: 0, valor: "0.00" },
  };
  for (const b of cobrancas) {
    const aberto = Math.max(0, n(b.amount) - n(b.paidTotal));
    if (aberto <= 0 || b.status === "CANCELED") continue;
    if (b.dueDate >= corte) continue;
    const dias = Math.floor((corte.getTime() - b.dueDate.getTime()) / 86400000);
    const f = aging[faixa(dias)];
    f.qtd += 1;
    f.valor = money(Number(f.valor) + aberto);
  }

  return {
    carteira: relacoes.map((r) => ({
      relationshipId: r.id, clientId: r.clientId, nome: r.client.name,
      agencyId: r.agencyId, ciclo: r.lifecycleStatus, financeiro: r.financialStatus,
      entrada: r.startedAt,
    })),
    termos_vigentes: termos.map((t) => ({
      id: t.id, relationshipId: t.relationshipId, modalidade: t.modality,
      mensal: t.monthlyValue == null ? null : money(n(t.monthlyValue)),
      total: t.totalContractValue == null ? null : money(n(t.totalContractValue)),
      meses: t.contractMonths, desde: t.validFrom,
    })),
    receber: {
      cobrancas: cobrancas.map((b) => ({
        id: b.id, clientId: b.clientId, relationshipId: b.relationshipId,
        valor: money(n(b.amount)), pago: money(n(b.paidTotal)),
        aberto: money(Math.max(0, n(b.amount) - n(b.paidTotal))),
        situacao: b.status, vencimento: b.dueDate,
        natureza: b.billingKind, reconhecimento: b.recognitionMode,
      })),
      aging,
    },
    pagar: despesas.map((d) => ({
      id: d.id, valor: money(n(d.amount)), situacao: d.status,
      categoria: d.categoryId, data: d.date,
    })),
    caixa_reservas: {
      contas: contas.map((c) => ({
        id: c.id, nome: c.name, tipo: c.type, saldo: money(n(c.balance)),
      })),
      reservas: reservas.map((r) => ({
        id: r.id, nome: r.name, atual: money(n(r.currentAmount)),
        meta: money(n(r.targetAmount)),
      })),
    },
    folha: folha.map((f) => ({
      id: f.id, situacao: f.status, pagoEm: f.paidAt,
      itens: f.items.map((i) => ({
        id: i.id, employeeId: i.employeeId, valor: money(n(i.amount)),
      })),
    })),
    avaliacao: avaliacoes.map((a) => ({
      id: a.id, relationshipId: a.relationshipId, estabilidade: a.estabilidade,
      ads: a.ads, risco: a.risco, upsell: a.upsell, confirmada: !!a.confirmedAt,
    })),
    indicadores: Object.fromEntries(
      Object.entries(metricas).map(([k, v]: [string, any]) => [
        k,
        { valor: v?.value ?? null, base: v?.basis ?? null },
      ])
    ),
    // Áreas que 01 §5.4 nomeia e cuja fonte só nasce depois. Declaradas, não
    // omitidas nem zeradas: área vazia é indistinguível de área que zerou.
    funil: indisponivel("O funil comercial nasce na Fase 4 (F4.1)."),
    dre_razao_resumido: indisponivel(
      "O DRE por competência nasce na Fase 3 (F3.2). O razão em si já existe e é conferido pelo job de integridade."
    ),
  };
}

export type ResultadoSnapshot = {
  id: string;
  competence: string;
  version: number;
  checksum: string;
  areas: string[];
  sourceCutoffAt: Date;
};

export async function gerarSnapshot(
  competence: Competence | string,
  opts: {
    version?: number;
    kind?: "NATIVE" | "STANDALONE" | "REBUILT_FROM_MIGRATION";
    name?: string;
    closedBy?: string | null;
    layoutDefinition?: unknown;
  } = {}
): Promise<ResultadoSnapshot> {
  const workspaceId = await currentWorkspaceId();
  // O corte é lido ANTES das consultas: um corte definido depois deixaria de
  // fora fatos gravados durante a própria leitura.
  const sourceCutoffAt = new Date();

  const areas = await montarAreas(competence);
  const { porArea, total } = checksumByArea(areas);

  const row = await runWithoutScope(async () =>
    prisma.snapshot.create({
      data: {
        workspaceId,
        scopeType: "WORKSPACE",
        scopeId: "",
        competence,
        version: opts.version ?? 1,
        kind: opts.kind ?? "NATIVE",
        name: opts.name ?? "",
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        metricRegistryVersion: METRIC_REGISTRY_VERSION,
        sourceCutoffAt,
        systemVersion: process.env.npm_package_version ?? null,
        closedBy: opts.closedBy ?? null,
        areas: areas as any,
        layoutDefinition: (opts.layoutDefinition ?? null) as any,
        checksum: total,
        checksumByArea: porArea as any,
      },
      select: { id: true },
    })
  );

  return {
    id: row.id,
    competence,
    version: opts.version ?? 1,
    checksum: total,
    areas: Object.keys(areas).sort(),
    sourceCutoffAt,
  };
}

/** A fotografia vigente de uma competência (a maior versão nativa). */
export async function snapshotDe(competence: Competence | string) {
  const workspaceId = await currentWorkspaceId();
  return runWithoutScope(async () =>
    prisma.snapshot.findFirst({
      where: { workspaceId, competence, kind: "NATIVE" },
      orderBy: { version: "desc" },
    })
  );
}
