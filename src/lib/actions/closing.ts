"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  fecharPeriodo, iniciarFechamento, marcarReconferido, reabrirParaOperacao,
  reabrirPeriodo,
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
  revalidatePath("/fechamento");
  return { ok: true as const, estado: p.estado, rotulo: p.rotulo };
}

export async function fecharPeriodoAction(competence: string) {
  const v = await requirePermission("fechamento.fechar");

  // O QUE ESTAVA PENDENTE FICA REGISTRADO NO FECHAMENTO.
  //
  // Nenhum item do checklist BLOQUEIA fechar: 01 §5.3 lista os dezesseis e
  // não diz quais impedem, e inventar essa regra seria inventar regra
  // financeira. Mas fechar sem deixar rastro do que faltava transformaria a
  // lista em decoração — daqui a seis meses ninguém saberia se o mês fechou
  // limpo ou fechou com doze pendências em aberto.
  const { resumoDoFechamento, pendenciasEmTexto } = await import(
    "@/lib/services/closing-checklist"
  );
  const resumo = await resumoDoFechamento(competence);

  const p = await fecharPeriodo(competence, v.name ?? null);

  const { auditEvent } = await import("@/lib/audit");
  const { prisma } = await import("@/lib/prisma");
  await auditEvent(prisma as any, "ClosingPeriod", competence, "CREATE", {
    origin: "UI",
    actorId: v.id,
    actorEmail: v.email ?? null,
    reason: `Fechamento de ${competence}. ${pendenciasEmTexto(resumo.itens)}`,
  });

  revalidatePath("/cobrancas");
  revalidatePath("/dashboard");
  revalidatePath("/fechamento");
  return {
    ok: true as const,
    estado: p.estado,
    rotulo: p.rotulo,
    pendencias: resumo.pendentes,
  };
}

export async function voltarParaOperacaoAction(competence: string) {
  const v = await requirePermission("fechamento.fechar");
  void v;
  const p = await reabrirParaOperacao(competence);
  revalidatePath("/cobrancas");
  revalidatePath("/fechamento");
  return { ok: true as const, estado: p.estado, rotulo: p.rotulo };
}

export async function reabrirPeriodoAction(competence: string, motivo: string) {
  const v = await requirePermission("fechamento.reabrir");
  const r = await reabrirPeriodo(competence, motivo, v.name ?? null);
  if (!r.ok) return r;
  revalidatePath("/cobrancas");
  revalidatePath("/dashboard");
  revalidatePath("/fechamento");
  return {
    ok: true as const,
    estado: r.periodo.estado,
    rotulo: r.periodo.rotulo,
    /** Quantos meses posteriores ficaram marcados para reconferência. */
    marcados: r.marcados,
  };
}

/**
 * "Conferi e continua valendo" (F2.6 · 01 §5.5).
 *
 * Guardada por `fechamento.fechar` e não por `reabrir`: quem reconfere é quem
 * fecha o mês, não quem tem poder de reescrever o passado.
 */
export async function marcarReconferidoAction(competence: string, nota: string) {
  const v = await requirePermission("fechamento.fechar");
  const r = await marcarReconferido(competence, nota, v.name ?? null);
  if (!r.ok) return r;
  revalidatePath("/fechamento");
  revalidatePath("/cobrancas");
  return r;
}

/**
 * FOTOGRAFIA AVULSA (F2.9 · 01 §5.7).
 *
 * "Fotografia nomeada por permissão, SEM fechar período."
 *
 * Serve para congelar o mês antes de um gesto grande — uma renegociação, um
 * write-off, uma correção em massa — e poder voltar e comparar. Ela NUNCA se
 * passa por fechamento: nasce marcada STANDALONE e não vira a fotografia
 * vigente do mês, que continua sendo a nativa.
 */
export async function criarFotografiaAvulsaAction(competence: string, nome: string) {
  const v = await requirePermission("fechamento.fotografar");
  const texto = (nome ?? "").trim();
  if (texto.length < 3) {
    return { ok: false as const, error: "Dê um nome à fotografia (pelo menos 3 caracteres)." };
  }
  const { gerarSnapshot } = await import("@/lib/snapshots/engine");
  try {
    const r = await gerarSnapshot(competence, {
      kind: "STANDALONE",
      name: texto,
      closedBy: v.name ?? null,
    });
    revalidatePath("/fechamento/fotografia");
    return { ok: true as const, id: r.id, checksum: r.checksum };
  } catch (e: any) {
    // O índice único recusa duas avulsas com o mesmo nome no mesmo mês — e
    // isso é bom: duas "Antes da renegociação" seriam indistinguíveis na hora
    // de comparar.
    if (e?.code === "P2002") {
      return { ok: false as const, error: "Já existe uma fotografia com esse nome neste mês." };
    }
    throw e;
  }
}
