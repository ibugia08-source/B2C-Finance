"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  conciliar, conciliarAutomaticamente, ignorarLinha, importarExtrato, reabrirLinha,
  sugerirMatches, type AlvoDeMatch,
} from "@/lib/services/reconciliation";
import type { Competence } from "@/lib/competence";

/**
 * Ações da conciliação (F3.5 · 02 §4.4).
 *
 * Nenhuma delas cria receita ou despesa. A que mais chega perto — confirmar
 * com diferença — apenas ESCREVE a diferença na linha e a manda para revisão.
 */

const MAX_ARQUIVO = 5 * 1024 * 1024;

export async function importarExtratoAction(fd: FormData) {
  await requirePermission("conciliacao.conciliar");

  let accountId = String(fd.get("accountId") ?? "");
  const nomeDaConta = String(fd.get("accountName") ?? "").trim();
  // Sem cadastro manual de conta (decisão de 02/09), a conta NASCE aqui:
  // a primeira importação de um extrato batiza a conta pelo nome que o dono
  // usa para ela. Saldo inicial não é chutado — a âncora é o extrato.
  if (!accountId && nomeDaConta) {
    if (nomeDaConta.length < 3)
      return { ok: false as const, error: "Dê um nome à conta (ex.: Itaú PJ)." };
    const { prisma } = await import("@/lib/prisma");
    const igual = await prisma.account.findFirst({
      where: { name: { equals: nomeDaConta, mode: "insensitive" } },
      select: { id: true },
    });
    accountId =
      igual?.id ??
      (
        await prisma.account.create({
          data: { name: nomeDaConta, type: "corrente", balance: 0 },
          select: { id: true },
        })
      ).id;
  }
  if (!accountId)
    return { ok: false as const, error: "Escolha a conta do extrato — ou dê nome a uma nova." };

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

/**
 * F5.3 — o botão "Conciliar automaticamente". Só resolve o óbvio (um
 * candidato, mesmo valor, até 3 dias); o ambíguo continua na tela, com o
 * motivo de ter ficado.
 */
export async function conciliarAutomaticamenteAction(accountId: string, competence: string) {
  await requirePermission("conciliacao.conciliar");
  const r = await conciliarAutomaticamente(accountId, competence as Competence);
  revalidatePath("/conciliacao");
  revalidatePath("/fila");
  return r;
}
