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
      await prisma.paymentApplication.deleteMany({ where: { billingId: { in: billingIds } } });
      await prisma.payment.deleteMany({ where: { billingId: { in: billingIds } } });
    }
    // F3.4 — rateio antes do resto: ele aponta para despesa e cliente por id,
    // sem chave estrangeira, então nada o arrasta junto.
    await prisma.allocation.deleteMany({ where: { ownerId: owner.id } });
    await prisma.allocationRule.deleteMany({ where: { ownerId: owner.id } });
    // F4.1 — comercial: evento antes da oportunidade, interação antes de tudo.
    await prisma.pipelineEvent.deleteMany({ where: { ownerId: owner.id } });
    await prisma.interaction.deleteMany({ where: { ownerId: owner.id } });
    await prisma.opportunity.deleteMany({ where: { ownerId: owner.id } });
    await prisma.lead.deleteMany({ where: { ownerId: owner.id } });
    await prisma.atividadeDiaria.deleteMany({ where: { ownerId: owner.id } });
    await prisma.gastoAdsDiario.deleteMany({ where: { ownerId: owner.id } });
    await prisma.commercialGoal.deleteMany({ where: { ownerId: owner.id } });
    // F3.5 — conciliação: match antes da linha, linha antes do extrato.
    await prisma.reconciliationMatch.deleteMany({ where: { ownerId: owner.id } });
    await prisma.bankStatementEntry.deleteMany({ where: { ownerId: owner.id } });
    await prisma.bankStatement.deleteMany({ where: { ownerId: owner.id } });
    await prisma.income.deleteMany({ where: { ownerId: owner.id } });
    await prisma.collectionHistory.deleteMany({ where: { ownerId: owner.id } });
    await prisma.billing.deleteMany({ where: { ownerId: owner.id } });
    await prisma.clientRenewal.deleteMany({ where: { ownerId: owner.id } });
    // AuditLog é append-only por gatilho: não se apaga nem na limpeza de
    // teste. Cada teste usa um dono novo, então não há vazamento entre eles.
    await prisma.customerCreditMovement.deleteMany({ where: { ownerId: owner.id } });
    await prisma.customerCredit.deleteMany({ where: { ownerId: owner.id } });
    await prisma.clientLoss.deleteMany({ where: { ownerId: owner.id } });
    // F1.1 — o que pertence à relação sai antes dela, e ela antes do cliente.
    await prisma.onboardingTask.deleteMany({ where: { ownerId: owner.id } });
    await prisma.avaliacaoMensal.deleteMany({ where: { ownerId: owner.id } });
    await prisma.clientManagerAssignment.deleteMany({ where: { ownerId: owner.id } });
    await prisma.commercialTerm.deleteMany({ where: { ownerId: owner.id } });
    // O cache aponta para o termo; zerar antes evita a FK travar a limpeza.
    await prisma.clientAgencyRelationship.updateMany({
      where: { ownerId: owner.id },
      data: { currentCommercialTermId: null },
    });
    await prisma.commercialTerm.deleteMany({ where: { relationship: { ownerId: owner.id } } });
    await prisma.clientAgencyRelationship.deleteMany({ where: { ownerId: owner.id } });
    await prisma.contractService.deleteMany({
      where: { contract: { ownerId: owner.id } },
    });
    await prisma.contract.deleteMany({ where: { ownerId: owner.id } });
    await prisma.clientContact.deleteMany({ where: { client: { ownerId: owner.id } } });
    await prisma.employee.deleteMany({ where: { ownerId: owner.id } });
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

/** Agência semeada pela migration da F0.5 (B2C Gestão). */
export async function defaultAgency(): Promise<{ id: string; name: string }> {
  // Agency é do WORKSPACE, não de um dono: consulta fora do escopo.
  const a = await runWithoutScope(async () =>
    prisma.agency.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true } })
  );
  if (!a) throw new Error("Nenhuma agência semeada — rode as migrations no banco de teste.");
  return a;
}

/** Relação cliente ↔ agência (F1.1). */
export async function createRelationship(
  owner: TestOwner,
  clientId: string,
  opts: { agencyId?: string; lifecycleStatus?: any; startedAt?: Date } = {}
) {
  const agencyId = opts.agencyId ?? (await defaultAgency()).id;
  return asOwner(owner, async () =>
    prisma.clientAgencyRelationship.create({
      data: {
        clientId,
        agencyId,
        lifecycleStatus: opts.lifecycleStatus ?? "ACTIVE",
        startedAt: opts.startedAt ?? new Date(2026, 0, 1),
      },
      select: { id: true, clientId: true, agencyId: true },
    })
  );
}

export { prisma, runWithoutScope };
