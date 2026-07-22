import { PrismaClient } from "@prisma/client";
import { getOwnerContext, resolveOwnerId } from "@/lib/auth/owner-scope";

/**
 * Entidades PRIVADAS por usuário (multiusuário). Toda leitura/criação é
 * automaticamente escopada por `ownerId` pela extensão abaixo.
 * Modelos globais (compartilhados): User, Category, AISetting, AIMessage.
 * Obs.: AIConversation/AIMemory são privados (histórico e memória do Assistente
 * por usuário); AIMessage segue as conversas do dono via conversationId.
 */
const OWNED_MODELS = new Set<string>([
  "Account",
  "CreditCard",
  "AccountCard",
  "Transaction",
  "CreditCardInvoice",
  "Installment",
  "Receivable",
  "Income",
  "CashBox",
  "CashBoxMovement",
  "Person",
  "PersonPayment",
  "ImportBatch",
  "CategorizationRule",
  "AIConversation",
  "AIMemory",
  // ===== ERP de agência =====
  "Client",
  "ClientContact",
  "Service",
  "Contract",
  "ContractService",
  "Billing",
  "Payment",
  "CollectionHistory",
  "Employee",
  "Payroll",
  "PayrollItem",
  "Commission",
  "Asset",
  "Liability",
  "Loan",
  "ImportTemplate",
  "ExportReport",
  "FinancialAlert",
  "SavedView",
  // Contratos documentais + dossiê do cliente
  "ContractTemplate",
  "GeneratedContract",
  "ClientDocument",
  "ClientNote",
  // Perdas de clientes, Ofertas (Planos), Upsell e Receita Extra
  "ClientLoss",
  "Offer",
  "OfferService",
  "Upsell",
  "ExtraRevenue",
  // Rotina diária (estado do dia: remoções + checklist)
  "RoutineItemState",
  // Inadimplência manual por competência (histórico mês a mês)
  "ClientMonthDelinquency",
]);

// Valor impossível → quando não há dono resolvido, nada casa (fail-closed):
// preferimos "não mostrar nada" a "vazar tudo".
const NO_OWNER = "__no_owner__";

const READ_WHERE = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const WHERE_WRITE = new Set(["updateMany", "deleteMany"]);
const CREATE_MANY = new Set(["createMany", "createManyAndReturn"]);

function injectOwnerData<T extends Record<string, any>>(data: T, uid: string): T {
  return data.ownerId == null ? { ...data, ownerId: uid } : data;
}

function makeClient() {
  // PRISMA_LOG=1 → loga cada query com duração (profiling manual/FASE 3).
  // Desligado por padrão; sem efeito em produção.
  const logQueries = process.env.PRISMA_LOG === "1";
  const base = new PrismaClient({
    log: logQueries
      ? ([{ emit: "event", level: "query" }, "error"] as any)
      : process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
  if (logQueries) {
    let count = 0;
    (base as any).$on("query", (e: { duration: number; query: string }) => {
      count += 1;
      console.log(
        `[prisma #${String(count).padStart(3)}] ${String(e.duration).padStart(5)}ms  ${e.query.slice(0, 110)}`
      );
    });
  }

  return base.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        // Modelos globais: passam direto (nunca resolve dono → sem recursão).
        if (!model || !OWNED_MODELS.has(model)) {
          return query(args as any);
        }

        // Bypass explícito (scripts de manutenção / seed).
        const ctx = getOwnerContext();
        if (ctx?.bypass) return query(args as any);

        const ownerId = (await resolveOwnerId()) ?? NO_OWNER;
        const a: any = args ?? {};

        if (READ_WHERE.has(operation) || WHERE_WRITE.has(operation)) {
          a.where = { ...(a.where ?? {}), ownerId };
          return query(a);
        }

        if (operation === "create") {
          a.data = injectOwnerData(a.data ?? {}, ownerId);
          return query(a);
        }

        if (CREATE_MANY.has(operation)) {
          const rows = Array.isArray(a.data) ? a.data : [a.data];
          a.data = rows.map((d: any) => injectOwnerData(d ?? {}, ownerId));
          return query(a);
        }

        // findUnique/update/delete/upsert usam `where` único (não aceita
        // ownerId). Como os IDs só chegam de listas já escopadas, o risco de
        // acessar registro de outro dono é residual; ainda assim, filtramos
        // as LEITURAS por dono para defesa em profundidade.
        if (operation === "findUnique" || operation === "findUniqueOrThrow") {
          const res: any = await query(a);
          if (res && res.ownerId != null && res.ownerId !== ownerId) {
            if (operation === "findUniqueOrThrow") {
              throw new Error("Registro não encontrado.");
            }
            return null;
          }
          return res;
        }

        return query(a);
      },
    },
  });
}

type ExtendedPrisma = ReturnType<typeof makeClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrisma };

export const prisma: ExtendedPrisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
