"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/viewer";
import { CACHE_TAGS } from "@/lib/cache-tags";
import type { ActionResult } from "./clients";
import { clean, parseBRL } from "@/lib/format";

/**
 * CONTAS DO CAIXA — UX-01 e DA-12 da auditoria de 11/09/2026.
 *
 * As contas bancárias eram LIDAS por dez telas (liquidez, fluxo projetado,
 * fechamento, recebimentos, snapshots…) e não tinham nenhuma tela para
 * cadastrar. O resultado era o fluxo de caixa abrindo com saldo inicial zero
 * e "nenhuma conta disponível" no filtro — que a auditoria leu, com razão,
 * como projeção sem origem de dados.
 *
 * TIPOS DE CONTA: a lista fechada vive em lib/conta-meta (TIPOS_DE_CONTA).
 * Ela NÃO pode ser exportada daqui: este arquivo é "use server", e o Next
 * registra TODO export como server action — um objeto exportado derruba o
 * módulo inteiro em tempo de execução ("A 'use server' file can only export
 * async functions, found object"), e o sintoma era "Nova conta" falhando em
 * produção com erro genérico (24/09/2026). O build passa; só a chamada quebra.
 */

const ContaSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Informe o nome da conta."),
  bank: z.string().trim().nullable(),
  type: z.enum(["corrente", "poupanca", "dinheiro", "investimento"]),
  balance: z.number().finite("Saldo inválido."),
  active: z.boolean().default(true),
});

function revalidarCaixa() {
  // O saldo entra na liquidez, no fluxo e no painel — os três precisam cair.
  revalidateTag(CACHE_TAGS.DASHBOARD_METRICS);
  for (const p of ["/caixa", "/fluxo", "/dashboard", "/projecoes", "/rotina"]) {
    revalidatePath(p);
  }
}

export async function salvarConta(formData: FormData): Promise<ActionResult> {
  await requirePermission("caixa.gerenciar_contas");
  try {
    const parsed = ContaSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      name: String(formData.get("name") ?? "").trim(),
      bank: clean(formData.get("bank")),
      type: String(formData.get("type") ?? "corrente"),
      balance: parseBRL(String(formData.get("balance") ?? "0")),
      active: formData.get("active") !== "false",
    });
    const { id, ...data } = parsed;
    const saved = id
      ? await prisma.account.update({ where: { id }, data })
      : await prisma.account.create({ data });
    revalidarCaixa();
    return { ok: true, id: saved.id };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar a conta.",
    };
  }
}

/**
 * Desativar é o caminho normal; excluir só quando a conta nunca foi usada.
 * Conta com movimento apagada levaria embora o histórico que a concilia.
 */
export async function excluirConta(id: string): Promise<ActionResult> {
  await requirePermission("caixa.gerenciar_contas");
  try {
    const [transacoes, recebimentos, pagamentos] = await Promise.all([
      prisma.transaction.count({ where: { accountId: id } }),
      prisma.income.count({ where: { accountId: id } }),
      prisma.payment.count({ where: { accountId: id } }),
    ]);
    const usos = transacoes + recebimentos + pagamentos;
    if (usos > 0) {
      return {
        ok: false,
        error: `Esta conta tem ${usos} lançamento(s) ligados a ela. Desative-a em vez de excluir — apagar levaria o histórico junto.`,
      };
    }
    await prisma.account.deleteMany({ where: { id } });
    revalidarCaixa();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir a conta." };
  }
}
