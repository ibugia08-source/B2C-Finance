import { prisma } from "@/lib/prisma";

/**
 * Exclusão PROFUNDA de clientes (Gestão de Carteira → Excluir).
 *
 * Client é referenciado por Contract e Billing SEM cascade (restrição de FK)
 * — e desde que o ciclo mensal gera mensalidades, todo cliente ativo tem
 * cobranças, então `client.delete` puro falha (P2003). Aqui removemos o
 * rastro financeiro na ordem correta, numa transação:
 *   pagamentos → conciliações/receitas do cliente → históricos de cobrança
 *   → receitas extras → cobranças → contratos → cliente
 * (documentos, notas, contatos, perdas e upsells já caem por cascade;
 * transações/comissões apontam para null automaticamente).
 *
 * Escopo por dono: todas as consultas passam pela extensão do Prisma.
 */
export async function deleteClientsDeep(ids: string[]): Promise<{ deleted: number }> {
  if (ids.length === 0) return { deleted: 0 };

  // Confirma quais clientes existem (e pertencem ao dono).
  const owned = await prisma.client.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const clientIds = owned.map((c) => c.id);
  if (clientIds.length === 0) return { deleted: 0 };

  const billings = await prisma.billing.findMany({
    where: { clientId: { in: clientIds } },
    select: { id: true },
  });
  const billingIds = billings.map((b) => b.id);

  await prisma.$transaction([
    ...(billingIds.length
      ? [prisma.payment.deleteMany({ where: { billingId: { in: billingIds } } })]
      : []),
    prisma.income.deleteMany({ where: { clientId: { in: clientIds } } }),
    prisma.collectionHistory.deleteMany({
      where: {
        OR: [
          { clientId: { in: clientIds } },
          ...(billingIds.length ? [{ billingId: { in: billingIds } }] : []),
        ],
      },
    }),
    prisma.extraRevenue.deleteMany({ where: { clientId: { in: clientIds } } }),
    prisma.billing.deleteMany({ where: { clientId: { in: clientIds } } }),
    prisma.contract.deleteMany({ where: { clientId: { in: clientIds } } }),
    prisma.client.deleteMany({ where: { id: { in: clientIds } } }),
  ]);

  return { deleted: clientIds.length };
}
