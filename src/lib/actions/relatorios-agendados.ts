"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  agendarRelatorio, removerAgendamento, type Frequencia,
} from "@/lib/services/scheduled-reports";

/** Ações do agendamento de relatórios (F5.7). */

export async function agendarRelatorioAction(
  reportKey: string,
  frequency: Frequencia,
  recipientsTexto: string
) {
  const viewer = await requirePermission("configuracoes.editar");
  const r = await agendarRelatorio({
    reportKey,
    frequency,
    recipients: recipientsTexto.split(/[\n,;]+/),
    createdBy: viewer.email,
  });
  revalidatePath("/configuracoes/relatorios");
  return r;
}

export async function removerAgendamentoAction(id: string) {
  await requirePermission("configuracoes.editar");
  const r = await removerAgendamento(id);
  revalidatePath("/configuracoes/relatorios");
  return r;
}
