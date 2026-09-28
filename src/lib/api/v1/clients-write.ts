import { z } from "zod";
import { ClientStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { salvarCliente, type ClientInput } from "@/lib/services/client-service";
import {
  changeClientStatus, StatusChangeError, classifyEffectiveDate,
} from "@/lib/clients/status-history";
import { type DomainContext, domainActor, inDomain, statusCapabilities } from "@/lib/engines/domain";
import { getStartOfCompetence, todayKey } from "@/lib/competence";
import { ApiError } from "../auth";
import { competenciaSchema, dataSchema } from "../http";
import { auditar, colaborador, dataCivil, falhaDoDominio } from "./write-common";
import { detalharClienteApi, historicoDeStatusApi } from "./clients";

/**
 * ESCRITAS DE CLIENTE NA API. Cadastro/edição = `salvarCliente` (a mesma
 * regra do formulário: duplicidade, modalidade MRR/TCV, contrato e cobranças
 * na criação, expectativa de renovação). STATUS NUNCA muda por PATCH: só
 * por POST /status-changes, com vigência (linha do tempo), pela mesma
 * `changeClientStatus` da tela.
 */

const campos = {
  legalName: z.string().trim().max(200).nullable().optional(),
  document: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email("E-mail inválido.").nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  nicheId: z.string().trim().max(64).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  state: z.string().trim().length(2, "Use a sigla da UF (ex.: BA).").nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  legalRepresentative: z.string().trim().max(200).nullable().optional(),
  origin: z.string().trim().max(100).nullable().optional(),
  /** Colaborador responsável (Employee). */
  responsibleId: z.string().trim().max(64).nullable().optional(),
  operationsOwner: z.string().trim().max(100).nullable().optional(),
  paymentDay: z.number().int().min(1).max(31).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  modality: z.enum(["MRR", "TCV"]).nullable().optional(),
  monthlyValue: z.number().nonnegative().nullable().optional(),
  totalContractValue: z.number().nonnegative().nullable().optional(),
  /** Prazo em meses; `contractIndefinite: true` = Indeterminado (só MRR). */
  contractMonths: z.number().int().positive().max(120).nullable().optional(),
  contractIndefinite: z.boolean().optional(),
  startedAt: dataSchema.nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
};

export const ClientCreateBody = z
  .object({
    name: z.string().trim().min(1, "Informe o nome do cliente.").max(200),
    ...campos,
    /** Status inicial (a partir de hoje). Mudanças depois: /status-changes. */
    initialStatus: z.enum(["ACTIVE", "LEAD", "PROSPECT"]).default("ACTIVE"),
    /** Cadastrar mesmo havendo cliente com nome/documento igual. */
    allowDuplicate: z.boolean().default(false),
  })
  .strict();

export const ClientPatchBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    ...campos,
    status: z
      .undefined({
        invalid_type_error:
          "O status não se altera por PATCH: use POST /clients/{id}/status-changes, com a data de vigência.",
      })
      .optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Envie ao menos um campo para alterar.");

const tagsNormalizadas = (t: string[] | undefined) =>
  t ? Array.from(new Set(t.map((x) => x.trim().toLocaleLowerCase("pt-BR")).filter(Boolean))) : undefined;

const SNAPSHOT = {
  name: true, legalName: true, document: true, email: true, phone: true, nicheId: true, city: true, state: true,
  address: true, legalRepresentative: true, origin: true, salesOwnerId: true, salesOwner: true, opsOwner: true,
  paymentDay: true, tags: true, modality: true, monthlyValue: true, totalContractValue: true, contractMonths: true,
  contractIndefinite: true, startedAt: true, notes: true, status: true,
} as const;

export async function criarClienteApi(ctx: DomainContext, b: z.output<typeof ClientCreateBody>) {
  if (b.responsibleId) await colaborador(b.responsibleId);
  const input: ClientInput = {
    name: b.name,
    legalName: b.legalName ?? null,
    document: b.document ?? null,
    email: b.email ?? null,
    phone: b.phone ?? null,
    nicheId: b.nicheId ?? null,
    city: b.city ?? null,
    state: b.state?.toUpperCase() ?? null,
    address: b.address ?? null,
    legalRepresentative: b.legalRepresentative ?? null,
    origin: b.origin ?? null,
    salesOwnerId: b.responsibleId ?? null,
    opsOwner: b.operationsOwner ?? null,
    paymentDay: b.paymentDay ?? null,
    tags: tagsNormalizadas(b.tags) ?? [],
    status: b.initialStatus as ClientStatus,
    modality: b.modality ?? null,
    monthlyValue: b.monthlyValue ?? null,
    totalContractValue: b.totalContractValue ?? null,
    contractMonths: b.contractIndefinite ? null : b.contractMonths ?? null,
    contractIndefinite: b.contractIndefinite ?? false,
    startedAt: b.startedAt ? dataCivil(b.startedAt) : null,
    notes: b.notes ?? null,
    permitirDuplicado: b.allowDuplicate,
  };
  const r = await salvarCliente(ctx, input);
  if (!r.ok) throw falhaDoDominio(r);
  const id = r.id!;
  await auditar(ctx, { tipo: "CREATE", entity: "Client", id, motivo: "Cliente cadastrado pela API" });
  return (await inDomain(ctx, async () => await detalharClienteApi(id)))!;
}

export async function atualizarClienteApi(ctx: DomainContext, id: string, b: z.output<typeof ClientPatchBody>) {
  const atual = await inDomain(ctx, async () => await prisma.client.findFirst({ where: { id }, select: SNAPSHOT }));
  if (!atual) throw new ApiError(404, "not_found", "Cliente não encontrado.");
  if (b.responsibleId) await inDomain(ctx, async () => await colaborador(b.responsibleId!));
  const tem = <K extends keyof typeof b>(k: K) => b[k] !== undefined;
  const indefinido = tem("contractIndefinite") ? !!b.contractIndefinite : atual.contractIndefinite;
  const input: ClientInput = {
    id,
    name: b.name ?? atual.name,
    legalName: tem("legalName") ? b.legalName ?? null : atual.legalName,
    document: tem("document") ? b.document ?? null : atual.document,
    email: tem("email") ? b.email ?? null : atual.email,
    phone: tem("phone") ? b.phone ?? null : atual.phone,
    nicheId: tem("nicheId") ? b.nicheId ?? null : atual.nicheId,
    city: tem("city") ? b.city ?? null : atual.city,
    state: tem("state") ? b.state?.toUpperCase() ?? null : atual.state,
    address: tem("address") ? b.address ?? null : atual.address,
    legalRepresentative: tem("legalRepresentative") ? b.legalRepresentative ?? null : atual.legalRepresentative,
    origin: tem("origin") ? b.origin ?? null : atual.origin,
    // Responsável só em texto (importação) continua como está: "__texto__".
    salesOwnerId: tem("responsibleId")
      ? b.responsibleId ?? null
      : atual.salesOwnerId ?? (atual.salesOwner ? "__texto__" : null),
    opsOwner: tem("operationsOwner") ? b.operationsOwner ?? null : atual.opsOwner,
    paymentDay: tem("paymentDay") ? b.paymentDay ?? null : atual.paymentDay,
    tags: tagsNormalizadas(b.tags) ?? atual.tags,
    // O status ATUAL segue igual — salvarCliente não troca status aqui.
    status: atual.status,
    modality: tem("modality") ? b.modality ?? null : atual.modality,
    monthlyValue: tem("monthlyValue") ? b.monthlyValue ?? null : atual.monthlyValue == null ? null : Number(atual.monthlyValue),
    totalContractValue: tem("totalContractValue")
      ? b.totalContractValue ?? null
      : atual.totalContractValue == null ? null : Number(atual.totalContractValue),
    contractMonths: indefinido ? null : tem("contractMonths") ? b.contractMonths ?? null : atual.contractMonths,
    contractIndefinite: indefinido,
    startedAt: tem("startedAt") ? (b.startedAt ? dataCivil(b.startedAt) : null) : atual.startedAt,
    notes: tem("notes") ? b.notes ?? null : atual.notes,
  };
  const r = await salvarCliente(ctx, input);
  if (!r.ok) throw falhaDoDominio(r);
  const depois = await inDomain(ctx, async () => await prisma.client.findFirst({ where: { id }, select: SNAPSHOT }));
  await auditar(ctx, {
    tipo: "UPDATE", entity: "Client", id,
    antes: atual as Record<string, unknown>, depois: (depois ?? {}) as Record<string, unknown>,
    motivo: "Cliente atualizado pela API",
  });
  return (await inDomain(ctx, async () => await detalharClienteApi(id)))!;
}

// ---------------------------------------------------------------------------
// Status com vigência
// ---------------------------------------------------------------------------

export const StatusChangeBody = z
  .object({
    status: z.nativeEnum(ClientStatus),
    effectiveFrom: dataSchema,
    reason: z.string().trim().min(1).max(500).optional(),
    /** Perda: competência da renovação frustrada (módulo Renovações). */
    renewalCompetence: competenciaSchema.optional(),
    /**
     * Vigência num mês que JÁ PASSOU reescreve a carteira daquele mês. A API
     * só aceita com confirmação explícita — um agente não reescreve o
     * passado por engano.
     */
    allowRetroactive: z.boolean().default(false),
  })
  .strict();

const ERRO_STATUS: Record<string, { status: number; code: ApiError["code"] }> = {
  SEM_PERMISSAO: { status: 403, code: "insufficient_scope" },
  RETROATIVO: { status: 403, code: "insufficient_scope" },
  PROGRAMAR: { status: 403, code: "insufficient_scope" },
  COMPETENCIA_FECHADA: { status: 422, code: "competence_closed" },
  CLIENTE: { status: 404, code: "not_found" },
};

export async function alterarStatusApi(ctx: DomainContext, clientId: string, b: z.output<typeof StatusChangeBody>) {
  const existe = await inDomain(ctx, async () => await prisma.client.findFirst({ where: { id: clientId }, select: { id: true } }));
  if (!existe) throw new ApiError(404, "not_found", "Cliente não encontrado.");
  const today = todayKey();
  if (classifyEffectiveDate(b.effectiveFrom, today) === "RETROATIVA" && !b.allowRetroactive) {
    throw new ApiError(
      422,
      "retroactive_requires_confirmation",
      `A vigência ${b.effectiveFrom} é anterior a ${getStartOfCompetence(today.slice(0, 7))} e reescreve a carteira de um mês que já passou. Confirme com "allowRetroactive": true.`
    );
  }
  try {
    const r = await inDomain(ctx, async () =>
      await changeClientStatus(
        {
          clientId,
          status: b.status,
          effectiveFrom: b.effectiveFrom,
          reason: b.reason ?? null,
          renewalCompetence: b.renewalCompetence ?? null,
          actor: domainActor(ctx),
        },
        statusCapabilities(ctx)
      )
    );
    const historico = await inDomain(ctx, async () => await historicoDeStatusApi(clientId));
    return {
      change: {
        status: b.status,
        effectiveFrom: b.effectiveFrom,
        scheduled: r.programada,
        currentStatusChanged: r.statusAtualMudou,
        ...(r.aviso ? { warning: r.aviso } : {}),
      },
      statusHistory: historico,
    };
  } catch (e) {
    if (e instanceof StatusChangeError) {
      const m = ERRO_STATUS[e.code] ?? { status: 422, code: "unprocessable" as const };
      throw new ApiError(m.status, m.code, e.message);
    }
    throw e;
  }
}
