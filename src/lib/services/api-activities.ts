import type { ActivityKind, ActivityResult, ActivitySource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type DomainContext, inDomain } from "@/lib/engines/domain";
import { podeVerIntegracoes } from "./service-accounts";

/**
 * ATIVIDADES DA IA/API — leitura para a tela Configurações → Integrações →
 * Atividades. Escopada pelo dono (inDomain); exige integracoes.visualizar.
 * Página por data decrescente, no índice (ownerId, createdAt desc).
 */

export type FiltroDeAtividades = {
  serviceAccountId?: string;
  source?: ActivitySource;
  result?: ActivityResult;
  kind?: ActivityKind;
  page: number;
  pageSize: number;
};

export type AtividadeLinha = {
  id: string;
  createdAt: Date;
  integracao: string | null;
  serviceAccountId: string | null;
  source: ActivitySource;
  kind: ActivityKind;
  action: string;
  entityType: string | null;
  entityId: string | null;
  label: string | null;
  amount: number | null;
  result: ActivityResult;
  httpStatus: number;
  errorCode: string | null;
  requestId: string;
  replayOf: string | null;
};

export async function listarAtividades(ctx: DomainContext, f: FiltroDeAtividades) {
  if (!podeVerIntegracoes(ctx)) return { linhas: [] as AtividadeLinha[], total: 0, integracoes: [] as { id: string; name: string }[] };
  return inDomain(ctx, async () => {
    const where: Prisma.ApiActivityWhereInput = {
      ...(f.serviceAccountId ? { serviceAccountId: f.serviceAccountId } : {}),
      ...(f.source ? { source: f.source } : {}),
      ...(f.result ? { result: f.result } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
    };
    const [total, linhas, contas] = await Promise.all([
      prisma.apiActivity.count({ where }),
      prisma.apiActivity.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      prisma.serviceAccount.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    const nome = new Map(contas.map((c) => [c.id, c.name]));
    // Rótulo da entidade: o que a chamada registrou; sem ele, o nome atual
    // do cliente (uma consulta para a página toda).
    const semRotulo = linhas.filter((l) => l.entityType === "Client" && l.entityId && !(l.metadata as any)?.label);
    const clientes = semRotulo.length
      ? await prisma.client.findMany({ where: { id: { in: semRotulo.map((l) => l.entityId!) } }, select: { id: true, name: true } })
      : [];
    const nomeCliente = new Map(clientes.map((c) => [c.id, c.name]));
    return {
      total,
      integracoes: contas,
      linhas: linhas.map<AtividadeLinha>((l) => {
        const m = (l.metadata ?? {}) as Record<string, unknown>;
        return {
          id: l.id,
          createdAt: l.createdAt,
          integracao: l.serviceAccountId ? (nome.get(l.serviceAccountId) ?? "Integração removida") : null,
          serviceAccountId: l.serviceAccountId,
          source: l.source,
          kind: l.kind,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          label: typeof m.label === "string" ? m.label : l.entityId ? (nomeCliente.get(l.entityId) ?? null) : null,
          amount: typeof m.amount === "number" ? m.amount : null,
          result: l.result,
          httpStatus: l.httpStatus,
          errorCode: l.errorCode,
          requestId: l.requestId,
          replayOf: typeof m.originalRequestId === "string" ? m.originalRequestId : null,
        };
      }),
    };
  });
}
