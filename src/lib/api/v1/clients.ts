import type { ClientStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getClientStatusesForCompetence, getClientStatusTimeline, getScheduledStatusChanges, getStatusesAtDate,
  type StatusInterval,
} from "@/lib/clients/status-history";
import { inadimplenciaEfetiva, whereDeClientes } from "@/lib/services/client-query";
import { getClientSummaries } from "@/lib/services/client-metrics";
import { competenceReferenceDate, todayKey, type Competence } from "@/lib/competence";
import { contractTermLabel } from "@/lib/renewal-expectation";
import { dinheiro, instante } from "../http";
import { dia, mascararDocumento, statusDoCliente } from "./common";

/**
 * CLIENTES NA API — leitura. Status sempre pela linha do tempo
 * (ClientStatusHistory): da competência pedida na lista, de hoje no detalhe.
 * `Client.status` não é lido como fonte em lugar nenhum daqui.
 */

export type FiltrosClientesApi = {
  competence: Competence;
  search?: string;
  status?: string;
  modality?: "MRR" | "TCV";
  responsible?: string;
  delinquency?: "paid" | "owing" | "no_billing";
  renewalMonth?: string;
  segment?: string;
  page: number;
  pageSize: number;
};

const DELINQ = { paid: "PAGO", owing: "DEVENDO", no_billing: "SEM_COBRANCA" } as const;
const DELINQ_OUT = { PAGO: "paid", DEVENDO: "owing", SEM_COBRANCA: "no_billing" } as const;

export async function listarClientesApi(f: FiltrosClientesApi) {
  const [year, month] = f.competence.split("-").map(Number);
  const hoje = todayKey();
  const statusDaComp = await getClientStatusesForCompetence(f.competence, { today: hoje });
  const where = whereDeClientes(statusDaComp, {
    status: f.status === "all" ? "todos" : f.status === "revenue_active" ? "ativos" : f.status,
    q: f.search,
    modalidade: f.modality,
    responsavel: f.responsible,
    mesRenovacao: f.renewalMonth,
    segmento: f.segment,
  });

  // Índice leve (só ids, ordenado) → inadimplência em lote → página.
  const index = await prisma.client.findMany({ where, orderBy: { name: "asc" }, select: { id: true } });
  const ids = index.map((c) => c.id);
  const delinq = await inadimplenciaEfetiva(ids, month, year);
  const filtrados = f.delinquency ? ids.filter((id) => delinq.get(id)?.value === DELINQ[f.delinquency!]) : ids;
  const total = filtrados.length;
  const pageIds = filtrados.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);

  const [rows, programadas] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true, name: true, legalName: true, document: true, segment: true, modality: true,
        salesOwner: true, paymentDay: true, monthlyValue: true, totalContractValue: true,
        contractMonths: true, contractIndefinite: true, expectedRenewalAt: true, startedAt: true,
      },
    }),
    getScheduledStatusChanges(pageIds, hoje),
  ]);
  const porId = new Map(rows.map((r) => [r.id, r]));
  const itens = pageIds
    .map((id) => porId.get(id))
    .filter((r): r is (typeof rows)[number] => !!r)
    .map((r) => {
      const d = delinq.get(r.id);
      const prog = programadas.get(r.id);
      return {
        id: r.id,
        name: r.name,
        legalName: r.legalName,
        document: mascararDocumento(r.document),
        status: statusDoCliente(statusDaComp.get(r.id)),
        modality: r.modality,
        segment: r.segment,
        responsible: r.salesOwner,
        paymentDay: r.paymentDay,
        monthlyValue: dinheiro(r.monthlyValue),
        totalContractValue: dinheiro(r.totalContractValue),
        contractTerm: contractTermLabel(r.contractMonths, r.contractIndefinite),
        expectedRenewalDate: dia(r.expectedRenewalAt),
        startedAt: dia(r.startedAt),
        delinquency: d ? { status: DELINQ_OUT[d.value], manual: d.manual } : null,
        scheduledStatusChange: prog ? { status: statusDoCliente(prog.status), effectiveFrom: prog.from } : null,
      };
    });
  return {
    itens,
    total,
    statusReference: { competence: f.competence, date: competenceReferenceDate(f.competence, hoje) },
  };
}

export async function detalharClienteApi(id: string, competence?: Competence) {
  const c = await prisma.client.findFirst({
    where: { id },
    select: {
      id: true, name: true, legalName: true, document: true, email: true, phone: true, segment: true,
      city: true, state: true, modality: true, salesOwner: true, opsOwner: true, paymentDay: true,
      monthlyValue: true, totalContractValue: true, contractMonths: true, contractIndefinite: true,
      expectedRenewalAt: true, startedAt: true, churnedAt: true, tags: true, createdAt: true,
      contacts: {
        select: { id: true, name: true, role: true, email: true, phone: true, isPrimary: true },
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      },
    },
  });
  if (!c) return null;
  const hoje = todayKey();
  const [agora, naComp, programada, resumo] = await Promise.all([
    getStatusesAtDate(hoje, [id]),
    competence ? getClientStatusesForCompetence(competence, { clientIds: [id], today: hoje }) : null,
    getScheduledStatusChanges([id], hoje),
    getClientSummaries([id]),
  ]);
  const s = resumo.get(id);
  const prog = programada.get(id);
  return {
    id: c.id,
    name: c.name,
    legalName: c.legalName,
    document: c.document,
    email: c.email,
    phone: c.phone,
    segment: c.segment,
    city: c.city,
    state: c.state,
    tags: c.tags,
    modality: c.modality,
    responsible: c.salesOwner,
    operationsOwner: c.opsOwner,
    paymentDay: c.paymentDay,
    monthlyValue: dinheiro(c.monthlyValue),
    totalContractValue: dinheiro(c.totalContractValue),
    contractTerm: contractTermLabel(c.contractMonths, c.contractIndefinite),
    contractMonths: c.contractMonths,
    contractIndefinite: c.contractIndefinite,
    expectedRenewalDate: dia(c.expectedRenewalAt),
    startedAt: dia(c.startedAt),
    churnedAt: dia(c.churnedAt),
    createdAt: instante(c.createdAt),
    status: {
      current: statusDoCliente(agora.get(id)),
      ...(competence
        ? { atCompetence: { competence, status: statusDoCliente(naComp?.get(id)) } }
        : {}),
      scheduledChange: prog ? { status: statusDoCliente(prog.status), effectiveFrom: prog.from } : null,
    },
    financial: s
      ? {
          activeContracts: s.activeContracts,
          openAmount: dinheiro(s.openAmount),
          overdueAmount: dinheiro(s.overdueAmount),
          totalRevenue: dinheiro(s.totalRevenue),
          nextDueDate: dia(s.nextDueDate),
          situation: s.situation,
          activeServices: s.activeServices,
        }
      : null,
    contacts: c.contacts,
  };
}

const intervalo = (i: StatusInterval) => ({
  id: i.id,
  status: statusDoCliente(i.status),
  effectiveFrom: i.from,
  effectiveTo: i.to,
  reason: i.reason,
  origin: i.origin,
  needsReview: i.needsReview,
  recordedAt: instante(i.createdAt),
});

export async function historicoDeStatusApi(id: string) {
  const existe = await prisma.client.findFirst({ where: { id }, select: { id: true } });
  if (!existe) return null;
  const hoje = todayKey();
  const linha = await getClientStatusTimeline(id);
  const atual = linha.find((i) => i.from <= hoje && (i.to == null || i.to >= hoje));
  return {
    clientId: id,
    today: hoje,
    currentStatus: statusDoCliente(atual?.status as ClientStatus | undefined),
    intervals: linha.map(intervalo),
    scheduled: linha.filter((i) => i.from > hoje).map(intervalo),
  };
}
