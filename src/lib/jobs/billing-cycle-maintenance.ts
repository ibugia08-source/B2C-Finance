/**
 * Billing Cycle Maintenance Job
 *
 * Garante que o ciclo mensal de cobranças está atualizado (idempotente):
 * - Marca vencidas as cobranças com dueDate < hoje
 * - Gera MRRs faltantes para o mês atual (se cliente ativo com contrato MRR)
 *
 * Usa advisory lock do PostgreSQL para evitar race condition em paralelo.
 *
 * Chamada por:
 * - Middleware: /clientes/[id]/recebimentos
 * - Cron job externo (futuro: Vercel Cron ou worker)
 */

import { prisma } from "@/lib/prisma";

const LOCK_ID = 1337; // Advisory lock ID (fixo)

export async function ensureBillingCycleUpToDate() {
  // Adquirir lock (PostgreSQL advisory lock — bloqueante se outro processo tem)
  await prisma.$executeRaw`SELECT pg_advisory_lock(${LOCK_ID})`;

  try {
    // 1. Marcar vencidas
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.billing.updateMany({
      where: {
        AND: [
          { dueDate: { lt: today } },
          { status: { in: ["UPCOMING", "PARTIAL"] } },
        ],
      },
      data: { status: "OVERDUE" as any },
    });

    // 2. Gerar MRRs faltantes do mês atual
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    const activeClients = await prisma.client.findMany({
      where: {
        status: "ACTIVE",
        modality: "MRR",
        archivedAt: null, // Apenas clientes não-arquivados
      },
      select: { id: true },
    });

    for (const client of activeClients) {
      // Verificar se já existe billing do cliente neste mês
      const existing = await prisma.billing.findFirst({
        where: {
          clientId: client.id,
          competenceMonth: currentMonth,
          competenceYear: currentYear,
        },
      });

      if (!existing) {
        // Procurar contrato MRR ativo
        const contract = await prisma.contract.findFirst({
          where: {
            clientId: client.id,
            type: "MRR",
            status: "ACTIVE",
            recurrence: "MONTHLY",
          },
        });

        if (contract) {
          // Gerar billing
          const dayOfMonth = contract.billingDay || 5;
          const dueDate = new Date(currentYear, currentMonth - 1, dayOfMonth);

          await prisma.billing.create({
            data: {
              clientId: client.id,
              contractId: contract.id,
              competenceMonth: currentMonth,
              competenceYear: currentYear,
              amount: contract.monthlyValue || 0,
              dueDate,
              description: `${contract.title} - ${currentMonth}/${currentYear}`,
              status: dueDate < today ? "OVERDUE" : "UPCOMING",
              revenueType: "MRR",
              ownerId: client.ownerId,
            } as any,
          });
        }
      }
    }
  } finally {
    // Liberar lock
    await prisma.$executeRaw`SELECT pg_advisory_unlock(${LOCK_ID})`;
  }
}

/**
 * Variante sem lock (para testes/scripts onde não há concorrência)
 */
export async function ensureBillingCycleUpToDateNoLock() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.billing.updateMany({
    where: {
      AND: [
        { dueDate: { lt: today } },
        { status: { in: ["UPCOMING", "PARTIAL"] } },
      ],
    },
    data: { status: "OVERDUE" as any },
  });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const activeClients = await prisma.client.findMany({
    where: {
      status: "ACTIVE",
      modality: "MRR",
      archivedAt: null,
    },
    select: { id: true },
  });

  for (const client of activeClients) {
    const existing = await prisma.billing.findFirst({
      where: {
        clientId: client.id,
        competenceMonth: currentMonth,
        competenceYear: currentYear,
      },
    });

    if (!existing) {
      const contract = await prisma.contract.findFirst({
        where: {
          clientId: client.id,
          type: "MRR",
          status: "ACTIVE",
          recurrence: "MONTHLY",
        },
      });

      if (contract) {
        const dayOfMonth = contract.billingDay || 5;
        const dueDate = new Date(currentYear, currentMonth - 1, dayOfMonth);

        await prisma.billing.create({
          data: {
            clientId: client.id,
            contractId: contract.id,
            competenceMonth: currentMonth,
            competenceYear: currentYear,
            amount: contract.monthlyValue || 0,
            dueDate,
            description: `${contract.title} - ${currentMonth}/${currentYear}`,
            status: dueDate < today ? "OVERDUE" : "UPCOMING",
            revenueType: "MRR",
            ownerId: client.ownerId,
          } as any,
        });
      }
    }
  }
}
