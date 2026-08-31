"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  fecharPeriodo, iniciarFechamento, reabrirParaOperacao, reabrirPeriodo,
} from "@/lib/services/closing-period";

/**
 * Fechar e reabrir o mês (F2.1 · 01 §5.2, §5.5).
 *
 * DECIDIDO 19.16 em 31/08: fecha e reabre o usuário Master, e a permissão é
 * CONCEDÍVEL a outros no painel. Por isso a guarda é `fechamento.fechar` /
 * `fechamento.reabrir` e não "é admin?" — nenhum papel nasce com elas, e o
 * dono concede um usuário por vez.
 */

export async function iniciarFechamentoAction(competence: string) {
  const v = await requirePermission("fechamento.fechar");
  const p = await iniciarFechamento(competence, v.name ?? null);
  revalidatePath("/cobrancas");
  return { ok: true as const, estado: p.estado, rotulo: p.rotulo };
}

export async function fecharPeriodoAction(competence: string) {
  const v = await requirePermission("fechamento.fechar");
  const p = await fecharPeriodo(competence, v.name ?? null);
  revalidatePath("/cobrancas");
  revalidatePath("/dashboard");
  return { ok: true as const, estado: p.estado, rotulo: p.rotulo };
}

export async function voltarParaOperacaoAction(competence: string) {
  const v = await requirePermission("fechamento.fechar");
  void v;
  const p = await reabrirParaOperacao(competence);
  revalidatePath("/cobrancas");
  return { ok: true as const, estado: p.estado, rotulo: p.rotulo };
}

export async function reabrirPeriodoAction(competence: string, motivo: string) {
  const v = await requirePermission("fechamento.reabrir");
  const r = await reabrirPeriodo(competence, motivo, v.name ?? null);
  if (!r.ok) return r;
  revalidatePath("/cobrancas");
  revalidatePath("/dashboard");
  return {
    ok: true as const,
    estado: r.periodo.estado,
    rotulo: r.periodo.rotulo,
    /** Quantos meses posteriores ficaram marcados para reconferência. */
    marcados: r.marcados,
  };
}
