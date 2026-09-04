import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { post, reverse, idempotencyKeyOf } from "@/lib/accounting/engine";
import { assertPeriodAllows } from "@/lib/services/closing-period";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { auditEvent } from "@/lib/audit";
import { toCompetence, type Competence } from "@/lib/competence";
import type { ExtraRevenueManualType } from "@/lib/extra-revenue-meta";

/**
 * RECEITA EXTRA — dinheiro que entra no caixa sem vir de cobrança a cliente
 * (rendimento, venda pontual, prêmio, ajuste). O fato reconhece E recebe ao
 * mesmo tempo (regra EXTRA_REVENUE_RECEIVED, 01 §3.6), na COMPETÊNCIA que o
 * dono informa no cadastro — que pode não ser o mês do caixa.
 *
 * Por isso a trava de período olha a competência INFORMADA: lançar (ou
 * excluir) receita extra num mês fechado mudaria um resultado já publicado.
 */

export type NovaReceitaExtra = {
  description: string;
  amount: number;
  competenceYear: number;
  competenceMonth: number;
  receivedAt: Date;
  type: ExtraRevenueManualType;
  clientId?: string | null;
  actorEmail?: string | null;
};

export type ResultadoReceitaExtra =
  | { ok: true; id: string; competence: Competence }
  | { ok: false; error: string };

class ReceitaExtraError extends Error {}

export async function lancarReceitaExtra(
  input: NovaReceitaExtra
): Promise<ResultadoReceitaExtra> {
  const description = input.description.trim();
  if (!description) return { ok: false, error: "Descreva a receita." };
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    return { ok: false, error: "O valor precisa ser maior que zero." };

  let competence: Competence;
  try {
    competence = toCompetence(input.competenceYear, input.competenceMonth);
  } catch {
    return { ok: false, error: "Competência inválida — informe mês e ano." };
  }

  const periodo = await assertPeriodAllows("EXTRA_REVENUE_RECEIVED", competence);
  if (!periodo.ok) return periodo;

  const workspaceId = await currentWorkspaceId();
  try {
    const criada = await prisma.$transaction(async (tx) => {
      const row = await tx.extraRevenue.create({
        data: {
          description,
          amount: input.amount,
          receivedAt: input.receivedAt,
          type: input.type,
          origin: "MANUAL",
          clientId: input.clientId ?? null,
          competenceMonth: input.competenceMonth,
          competenceYear: input.competenceYear,
        },
        select: { id: true, ownerId: true },
      });

      const contabil = await post(
        {
          eventType: "EXTRA_REVENUE_RECEIVED",
          sourceType: "ExtraRevenue",
          sourceId: row.id,
          competence,
          amount: input.amount,
          postedAt: input.receivedAt,
          context: {
            workspaceId,
            ownerId: row.ownerId,
            clientId: input.clientId ?? null,
            // Ajuste positivo tem conta própria no plano (5.2); o resto fica
            // na 5.3 da regra canônica.
            ...(input.type === "ADJUSTMENT" ? { creditAccountCode: "5.2" } : {}),
          },
        },
        tx as any
      );
      if (!contabil.ok) throw new ReceitaExtraError(contabil.error);

      await auditEvent(tx as any, "ExtraRevenue", row.id, "CREATE", {
        origin: "UI",
        reason: `Receita extra de ${competence}: ${description}`,
        actorEmail: input.actorEmail ?? null,
      });
      return row;
    });
    return { ok: true, id: criada.id, competence };
  } catch (e) {
    if (e instanceof ReceitaExtraError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function excluirReceitaExtra(
  id: string,
  opts: { actorEmail?: string | null } = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.extraRevenue.findUnique({
    where: { id },
    select: {
      id: true,
      description: true,
      origin: true,
      receivedAt: true,
      competenceMonth: true,
      competenceYear: true,
    },
  });
  if (!row) return { ok: false, error: "Receita extra não encontrada." };
  if (row.origin !== "MANUAL")
    return {
      ok: false,
      error: "Só receitas lançadas manualmente podem ser excluídas por aqui.",
    };

  const competence = toCompetence(
    row.competenceYear ?? row.receivedAt.getFullYear(),
    row.competenceMonth ?? row.receivedAt.getMonth() + 1
  );
  const periodo = await assertPeriodAllows("EXTRA_REVENUE_RECEIVED", competence);
  if (!periodo.ok) return periodo;

  // Estorna o razão ANTES de apagar a linha. Se a exclusão falhar depois, o
  // estado continua consistente (linha sem lançamento líquido) e um novo
  // clique só apaga — reverse é idempotente (ja_postado).
  const workspaceId = await currentWorkspaceId();
  const chave = idempotencyKeyOf({
    eventType: "EXTRA_REVENUE_RECEIVED",
    sourceType: "ExtraRevenue",
    sourceId: row.id,
    competence,
  });
  const lancamento = await runWithoutScope(async () =>
    prisma.ledgerTransaction.findFirst({
      where: { workspaceId, idempotencyKey: chave },
      select: { id: true },
    })
  );
  if (lancamento) {
    const estorno = await reverse(
      lancamento.id,
      `Exclusão da receita extra "${row.description}" (${competence}).`
    );
    if (!estorno.ok) return estorno;
  }

  await prisma.$transaction(async (tx) => {
    await tx.extraRevenue.delete({ where: { id: row.id } });
    await auditEvent(tx as any, "ExtraRevenue", row.id, "DELETE", {
      origin: "UI",
      reason: `Receita extra de ${competence} excluída: ${row.description}`,
      actorEmail: opts.actorEmail ?? null,
    });
  });
  return { ok: true };
}
