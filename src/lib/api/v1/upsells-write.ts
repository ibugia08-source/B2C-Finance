import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { salvarUpsell } from "@/lib/services/upsell-service";
import { type DomainContext, inDomain } from "@/lib/engines/domain";
import { toNumber as n } from "@/lib/format";
import { ApiError } from "../auth";
import { dataSchema } from "../http";
import { auditar, colaborador, dataCivil, falhaDoDominio, valor } from "./write-common";
import { detalharUpsellApi } from "./upsells";

/**
 * ESCRITAS DE UPSELL NA API — `salvarUpsell`, a mesma regra do formulário
 * (cliente e serviço do dono, valor, responsável herdado do cliente,
 * oportunidade + serviços numa transação).
 *
 * Decidir o funil (Vendido/Recusado) NÃO é feito pela API na V1: vender lança
 * cobrança na competência escolhida e desfazer cancela cobrança — gestos que
 * pedem a pergunta da tela. Por isso o status aceito é só o do funil aberto,
 * e oportunidade já decidida não é editada por aqui.
 */

const ABERTOS = ["OPPORTUNITY", "NEGOTIATION", "PAUSED"] as const;

const base = {
  serviceId: z.string().trim().max(64).nullable().optional(),
  /** Descrição curta da oportunidade (vira o título). */
  description: z.string().trim().max(200).nullable().optional(),
  amount: valor.optional(),
  /** Colaborador responsável (Employee). Sem ele, herda o do cliente. */
  responsibleId: z.string().trim().max(64).nullable().optional(),
  expectedCloseDate: dataSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(ABERTOS).optional(),
};

export const UpsellCreateBody = z
  .object({ clientId: z.string().trim().min(1).max(64), ...base, amount: valor })
  .strict()
  .refine((b) => !!(b.serviceId || b.description), "Informe serviceId ou description.");

export const UpsellPatchBody = z
  .object(base)
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Envie ao menos um campo para alterar.");

async function responsavel(id: string | null | undefined): Promise<string | null | undefined> {
  if (id === undefined) return undefined;
  if (id === null) return null;
  return (await colaborador(id)).name;
}

const SNAPSHOT = {
  id: true, clientId: true, serviceId: true, offerId: true, title: true, value: true, responsible: true,
  status: true, expectedCloseAt: true, notes: true,
  services: { select: { serviceId: true, unitPrice: true } },
} as const;

export async function criarUpsellApi(ctx: DomainContext, b: z.output<typeof UpsellCreateBody>) {
  const resp = await inDomain(ctx, async () => await responsavel(b.responsibleId));
  const r = await salvarUpsell(ctx, {
    clientId: b.clientId,
    serviceId: b.serviceId ?? null,
    offerId: null,
    title: b.description ?? null,
    value: b.amount,
    responsible: resp ?? null,
    status: b.status ?? "OPPORTUNITY",
    expectedCloseAt: b.expectedCloseDate ? dataCivil(b.expectedCloseDate) : null,
    notes: b.notes ?? null,
    services: b.serviceId ? [{ serviceId: b.serviceId, unitPrice: b.amount }] : [],
  });
  if (!r.ok) throw falhaDoDominio(r);
  await auditar(ctx, { tipo: "CREATE", entity: "Upsell", id: r.id!, motivo: "Upsell cadastrado pela API" });
  return (await inDomain(ctx, async () => await detalharUpsellApi(r.id!)))!;
}

export async function atualizarUpsellApi(ctx: DomainContext, id: string, b: z.output<typeof UpsellPatchBody>) {
  const atual = await inDomain(ctx, async () => await prisma.upsell.findFirst({ where: { id }, select: SNAPSHOT }));
  if (!atual) throw new ApiError(404, "not_found", "Oportunidade não encontrada.");
  if (atual.status === "WON" || atual.status === "LOST") {
    throw new ApiError(422, "invalid_state", "Oportunidade já decidida (vendida ou recusada) não é editada pela API.");
  }
  const resp = await inDomain(ctx, async () => await responsavel(b.responsibleId));
  const valorNovo = b.amount ?? n(atual.value);
  // Serviços: trocar o serviço substitui a lista; senão, a lista atual segue
  // (com o valor novo, quando é um serviço só).
  const services =
    b.serviceId !== undefined
      ? b.serviceId ? [{ serviceId: b.serviceId, unitPrice: valorNovo }] : []
      : atual.services.length === 1 && b.amount !== undefined
        ? [{ serviceId: atual.services[0].serviceId, unitPrice: valorNovo }]
        : atual.services.map((s) => ({ serviceId: s.serviceId, unitPrice: n(s.unitPrice) }));
  const r = await salvarUpsell(ctx, {
    id,
    clientId: atual.clientId,
    serviceId: b.serviceId !== undefined ? b.serviceId : atual.serviceId,
    offerId: atual.offerId,
    title: b.description !== undefined ? b.description : atual.title,
    value: valorNovo,
    responsible: resp !== undefined ? resp : atual.responsible,
    status: b.status ?? atual.status,
    expectedCloseAt:
      b.expectedCloseDate !== undefined ? (b.expectedCloseDate ? dataCivil(b.expectedCloseDate) : null) : atual.expectedCloseAt,
    notes: b.notes !== undefined ? b.notes : atual.notes,
    services,
  });
  if (!r.ok) throw falhaDoDominio(r);
  const depois = await inDomain(ctx, async () => await prisma.upsell.findFirst({ where: { id }, select: SNAPSHOT }));
  const plano = (u: typeof atual) => ({ ...u, services: u?.services.map((s) => `${s.serviceId}:${n(s.unitPrice)}`).join(",") });
  await auditar(ctx, {
    tipo: "UPDATE", entity: "Upsell", id,
    antes: plano(atual) as Record<string, unknown>, depois: (depois ? plano(depois) : {}) as Record<string, unknown>,
    motivo: "Upsell atualizado pela API",
  });
  return (await inDomain(ctx, async () => await detalharUpsellApi(id)))!;
}
