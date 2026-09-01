"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  conciliar, ignorarLinha, importarExtrato, reabrirLinha, sugerirMatches,
  type AlvoDeMatch,
} from "@/lib/services/reconciliation";

/**
 * Ações da conciliação (F3.5 · 02 §4.4).
 *
 * Nenhuma delas cria receita ou despesa. A que mais chega perto — confirmar
 * com diferença — apenas ESCREVE a diferença na linha e a manda para revisão.
 */

const MAX_ARQUIVO = 5 * 1024 * 1024;

export async function importarExtratoAction(fd: FormData) {
  await requirePermission("conciliacao.conciliar");

  const accountId = String(fd.get("accountId") ?? "");
  if (!accountId) return { ok: false as const, error: "Escolha a conta do extrato." };

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false as const, error: "Selecione o arquivo do extrato (.ofx ou .csv)." };
  if (file.size > MAX_ARQUIVO)
    return { ok: false as const, error: "Arquivo acima de 5MB." };

  // Extrato de banco brasileiro ainda vem em latin-1 com frequência; o
  // fallback evita transformar "TARIFA MANUTENÇÃO" em caracteres quebrados,
  // que depois estragariam o hash de deduplicação.
  const bytes = Buffer.from(await file.arrayBuffer());
  let texto = bytes.toString("utf8");
  if (texto.includes("�")) texto = bytes.toString("latin1");

  const r = await importarExtrato(accountId, file.name, texto);
  revalidatePath("/conciliacao");
  revalidatePath("/fechamento");
  return r;
}

export async function sugestoesAction(entryId: string) {
  await requirePermission("conciliacao.visualizar");
  return sugerirMatches(entryId);
}

export async function conciliarAction(
  entryId: string,
  alvos: { targetType: AlvoDeMatch; targetId: string; amount: number; confidence?: number }[],
  aceitarDiferenca?: string | null
) {
  await requirePermission("conciliacao.conciliar");
  const r = await conciliar({ entryId, alvos, aceitarDiferenca });
  revalidar();
  return r;
}

export async function ignorarLinhaAction(entryId: string, motivo: string) {
  await requirePermission("conciliacao.conciliar");
  const r = await ignorarLinha(entryId, motivo);
  revalidar();
  return r;
}

export async function reabrirLinhaAction(entryId: string) {
  await requirePermission("conciliacao.conciliar");
  const r = await reabrirLinha(entryId);
  revalidar();
  return r;
}

function revalidar() {
  revalidatePath("/conciliacao");
  revalidatePath("/fechamento");
}
