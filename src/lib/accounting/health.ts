import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { checkLedgerBalance } from "./engine";
import type { Competence } from "@/lib/competence";

/**
 * SAÚDE DO RAZÃO (F1.6 · ref. 01 §5.4).
 *
 * "job de verificação débito=crédito".
 *
 * São DUAS perguntas diferentes, e só a primeira é a clássica:
 *
 *  1. BALANÇO — toda transação tem débito igual a crédito? Se falhar,
 *     algo escreveu no razão por fora do motor. É erro grave.
 *
 *  2. COBERTURA — todo fato financeiro depois do corte tem lançamento?
 *     Um razão perfeitamente balanceado e VAZIO passa na pergunta 1 e
 *     mesmo assim não serve para nada. Esta é a pergunta que pega a
 *     bandeira desligada por engano, que é a falha mais provável na
 *     prática.
 */

export type LedgerHealth = {
  enabled: boolean;
  balanceOk: boolean;
  transacoes: number;
  desbalanceadas: { id: string; diferenca: string }[];
  /** Pagamentos sem lançamento correspondente, depois do corte. */
  pagamentosSemLancamento: number;
  cobertura: number | null;
  /** Data a partir da qual a cobertura é exigida (o corte). */
  desde: Date | null;
};

export async function ledgerHealth(
  workspaceId: string,
  opts: { desde?: Date | null; competence?: Competence } = {}
): Promise<LedgerHealth> {
  const flag = await runWithoutScope(async () =>
    prisma.featureFlag.findFirst({
      where: { workspaceId, key: "ledger_enabled" },
      select: { enabled: true },
    })
  );

  const balanco = await checkLedgerBalance(workspaceId, opts.competence);

  // Cobertura: pagamentos posteriores ao corte que não têm lançamento.
  // Antes do corte NÃO se exige nada — aquele período entra por um
  // lançamento de abertura só, não fato a fato.
  const desde = opts.desde ?? null;
  const [semLancamento, totalPagamentos] = await runWithoutScope(async () => {
    const where = desde ? Prisma.sql`AND p."paidAt" >= ${desde}` : Prisma.empty;
    const orfaos = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n
        FROM "Payment" p
       WHERE p."status" NOT IN ('FAILED', 'REFUNDED')
         ${where}
         AND NOT EXISTS (
           SELECT 1 FROM "LedgerTransaction" t
            WHERE t."sourceType" = 'Payment' AND t."sourceId" = p."id"
         )
    `;
    const total = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n
        FROM "Payment" p
       WHERE p."status" NOT IN ('FAILED', 'REFUNDED') ${where}
    `;
    return [Number(orfaos[0]?.n ?? 0), Number(total[0]?.n ?? 0)] as const;
  });

  return {
    enabled: flag?.enabled === true,
    balanceOk: balanco.ok,
    transacoes: balanco.transacoes,
    desbalanceadas: balanco.desbalanceadas,
    pagamentosSemLancamento: semLancamento,
    cobertura: totalPagamentos === 0 ? null : (totalPagamentos - semLancamento) / totalPagamentos,
    desde,
  };
}

/** Liga ou desliga a postagem no razão. Operação deliberada, nunca automática. */
export async function setLedgerEnabled(
  workspaceId: string,
  enabled: boolean
): Promise<void> {
  await runWithoutScope(async () => {
    const existente = await prisma.featureFlag.findFirst({
      where: { workspaceId, key: "ledger_enabled" },
      select: { id: true },
    });
    if (existente) {
      await prisma.featureFlag.update({ where: { id: existente.id }, data: { enabled } });
    } else {
      await prisma.featureFlag.create({
        data: { workspaceId, key: "ledger_enabled", enabled },
      });
    }
  });
}
