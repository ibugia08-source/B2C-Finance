import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { runWithoutScope, runWithOwner } from "@/lib/auth/owner-scope";

/**
 * Fixtures da suíte de proteção. Cada teste trabalha sob um DONO próprio
 * (User dedicado) — o escopo multiusuário do Prisma isola os dados, e a
 * limpeza apaga só o que aquele dono criou. Nenhum teste enxerga ou apaga
 * dado de outro.
 */

/** Trava dura: a suíte só fala com o banco de testes. */
export function assertTestDatabase() {
  const url =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL || "";
  if (!/127\.0\.0\.1|localhost/.test(url) || !/b2c_finance_test/.test(url)) {
    throw new Error(
      `Suíte abortada: banco de destino não é o de testes (${url.replace(/:[^:@]*@/, ":***@")})`
    );
  }
}

export type TestOwner = { id: string; email: string };

export async function createOwner(): Promise<TestOwner> {
  assertTestDatabase();
  const email = `teste-${randomUUID()}@b2c.local`;
  // NOTA: sempre `await` DENTRO do callback. Devolver a PrismaPromise sem
  // await executa a query FORA do AsyncLocalStorage — o escopo cai no
  // fail-closed e a criação falha por chave estrangeira (armadilha
  // documentada em src/lib/auth/owner-scope.ts).
  return await runWithoutScope(async () =>
    prisma.user.create({
      data: { name: "Dono de teste", email, passwordHash: "x", role: "ADMIN" },
      select: { id: true, email: true },
    })
  );
}

/** Executa `fn` como o dono informado (mesmo contexto que a app usa). */
export function asOwner<T>(owner: TestOwner, fn: () => Promise<T>): Promise<T> {
  return runWithOwner(owner.id, fn);
}

/**
 * Apaga tudo o que pertence ao dono, na ordem das dependências.
 * Roda sem escopo porque alguns registros legados podem ter ownerId nulo
 * quando criados por serviços internos.
 */
export async function destroyOwner(owner: TestOwner) {
  assertTestDatabase();
  await runWithoutScope(async () => {
    const billings = await prisma.billing.findMany({
      where: { ownerId: owner.id },
      select: { id: true },
    });
    const billingIds = billings.map((b) => b.id);
    if (billingIds.length) {
      await prisma.income.deleteMany({ where: { billingId: { in: billingIds } } });
      await prisma.extraRevenue.deleteMany({
        where: { originBillingId: { in: billingIds } },
      });
      await prisma.collectionHistory.deleteMany({
        where: { billingId: { in: billingIds } },
      });
      await prisma.payment.deleteMany({ where: { billingId: { in: billingIds } } });
    }
    await prisma.income.deleteMany({ where: { ownerId: owner.id } });
    await prisma.collectionHistory.deleteMany({ where: { ownerId: owner.id } });
    await prisma.billing.deleteMany({ where: { ownerId: owner.id } });
    await prisma.clientRenewal.deleteMany({ where: { ownerId: owner.id } });
    await prisma.clientLoss.deleteMany({ where: { ownerId: owner.id } });
    await prisma.contractService.deleteMany({
      where: { contract: { ownerId: owner.id } },
    });
    await prisma.contract.deleteMany({ where: { ownerId: owner.id } });
    await prisma.clientContact.deleteMany({ where: { client: { ownerId: owner.id } } });
    await prisma.client.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.deleteMany({ where: { id: owner.id } });
  });
}

/** Cliente MRR ativo, pronto para o ciclo mensal. */
export async function createMrrClient(
  owner: TestOwner,
  opts: { name?: string; monthlyValue?: number; paymentDay?: number; startedAt?: Date } = {}
) {
  return asOwner(owner, async () =>
    prisma.client.create({
      data: {
        name: opts.name ?? `Cliente ${randomUUID().slice(0, 8)}`,
        status: "ACTIVE",
        modality: "MRR",
        monthlyValue: opts.monthlyValue ?? 1000,
        paymentDay: opts.paymentDay ?? 10,
        startedAt: opts.startedAt ?? new Date(2026, 0, 1),
      },
      select: { id: true, name: true },
    })
  );
}

/** Cobrança de competência, em aberto. */
export async function createBilling(
  owner: TestOwner,
  clientId: string,
  opts: {
    month: number;
    year: number;
    amount?: number;
    dueDate?: Date;
    revenueType?: "MRR" | "TCV" | "SETUP" | "ONE_TIME" | "UPSELL";
    description?: string;
  }
) {
  const amount = opts.amount ?? 1000;
  return asOwner(owner, async () =>
    prisma.billing.create({
      data: {
        clientId,
        description:
          opts.description ??
          `Mensalidade ${String(opts.month).padStart(2, "0")}/${opts.year}`,
        competenceMonth: opts.month,
        competenceYear: opts.year,
        amount,
        dueDate: opts.dueDate ?? new Date(opts.year, opts.month - 1, 10),
        revenueType: (opts.revenueType ?? "MRR") as any,
        status: "PENDING",
      },
      select: { id: true, amount: true },
    })
  );
}

export { prisma, runWithoutScope };
