import type { Prisma, UpsellStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dinheiro, instante } from "../http";
import { dia } from "./common";

/** UPSELL NA API — leitura (mesmos campos da tela /upsell). */
export const UPSELL_STATUSES = ["OPPORTUNITY", "NEGOTIATION", "WON", "LOST", "PAUSED"] as const;

export async function listarUpsellsApi(f: {
  status?: UpsellStatus;
  clientId?: string;
  responsible?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.UpsellWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.clientId ? { clientId: f.clientId } : {}),
    ...(f.responsible ? { responsible: { equals: f.responsible, mode: "insensitive" } } : {}),
  };
  const [total, linhas, soma] = await Promise.all([
    prisma.upsell.count({ where }),
    prisma.upsell.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true, title: true, value: true, status: true, responsible: true, expectedCloseAt: true,
        closedAt: true, createdAt: true, billingId: true,
        client: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
        offer: { select: { id: true, name: true } },
        services: { select: { unitPrice: true, service: { select: { id: true, name: true } } } },
      },
    }),
    prisma.upsell.aggregate({ where, _sum: { value: true } }),
  ]);
  return {
    total,
    totalValue: dinheiro(soma._sum.value) ?? 0,
    itens: linhas.map((u) => ({
      id: u.id,
      title: u.title,
      client: u.client,
      value: dinheiro(u.value),
      status: u.status,
      responsible: u.responsible,
      expectedCloseDate: dia(u.expectedCloseAt),
      closedAt: instante(u.closedAt),
      createdAt: instante(u.createdAt),
      offer: u.offer,
      services: u.services.length
        ? u.services.map((s) => ({ ...s.service, unitPrice: dinheiro(s.unitPrice) }))
        : u.service
          ? [{ ...u.service, unitPrice: null }]
          : [],
      billingId: u.billingId,
    })),
  };
}
