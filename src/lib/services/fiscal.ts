import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";

/**
 * REGISTRO DE NOTA FISCAL (F3.6 · ref. 01 §4.7).
 *
 * DECIDIDO 19.38: registro OPCIONAL. Não há regra que gere pendência, nada
 * trava por falta de nota e nenhuma tela exige CNPJ — a direção disse que a
 * maioria dos serviços não emite.
 *
 * O QUE ISSO MUDA NO CÓDIGO, e é o ponto: não existe função "pendências
 * fiscais" aqui. Escrever uma e deixá-la sempre vazia seria construir a
 * cobrança que a direção decidiu não ter, e alguém acabaria ligando.
 */

export type RegistroDeNota = {
  billingId?: string | null;
  clientId?: string | null;
  legalEntityId?: string | null;
  type?: string;
  number: string;
  series?: string | null;
  accessKey?: string | null;
  issuedAt: Date;
  amount: number;
  notes?: string | null;
};

export async function registrarNota(
  input: RegistroDeNota
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const numero = (input.number ?? "").trim();
  if (!numero) return { ok: false, error: "Informe o número da nota." };
  if (!(input.amount > 0)) return { ok: false, error: "Informe o valor da nota." };

  // Mesma nota registrada duas vezes é o erro mais provável aqui: alguém
  // lança pela cobrança e outro pela ficha do cliente. O aviso é amigável em
  // vez de erro de banco.
  const repetida = await prisma.fiscalDocument.findFirst({
    where: { number: numero, status: { not: "CANCELLED" } },
    select: { id: true },
  });
  if (repetida) return { ok: false, error: `A nota ${numero} já está registrada.` };

  const doc = await prisma.fiscalDocument.create({
    data: {
      billingId: input.billingId ?? null,
      clientId: input.clientId ?? null,
      legalEntityId: input.legalEntityId ?? null,
      type: input.type ?? "NFSe",
      number: numero,
      series: input.series ?? null,
      accessKey: input.accessKey ?? null,
      issuedAt: input.issuedAt,
      amount: input.amount,
      notes: input.notes ?? null,
    },
    select: { id: true },
  });
  return { ok: true, id: doc.id };
}

export async function cancelarNota(
  id: string,
  motivo: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if ((motivo ?? "").trim().length < 5)
    return { ok: false, error: "Escreva o motivo do cancelamento." };
  const doc = await prisma.fiscalDocument.findUnique({ where: { id } });
  if (!doc) return { ok: false, error: "Nota não encontrada." };
  if (doc.status === "CANCELLED") return { ok: false, error: "Esta nota já está cancelada." };

  // O registro NÃO é apagado: uma nota cancelada continua existindo no mundo
  // real, e a conferência do contador precisa vê-la para entender por que o
  // número pulou.
  await prisma.fiscalDocument.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date(), notes: motivo.trim() },
  });
  return { ok: true };
}

export async function notasDoMes(competence: string) {
  const [ano, mes] = competence.split("-").map(Number);
  const docs = await prisma.fiscalDocument.findMany({
    where: { issuedAt: { gte: new Date(ano, mes - 1, 1), lt: new Date(ano, mes, 1) } },
    orderBy: { issuedAt: "desc" },
    include: { client: { select: { name: true } } },
  });
  return {
    docs,
    total: docs
      .filter((d) => d.status !== "CANCELLED")
      .reduce((s, d) => s + n(d.amount), 0),
  };
}

/** As notas de uma cobrança (a ficha do cliente mostra isso). */
export async function notasDa(billingId: string) {
  return prisma.fiscalDocument.findMany({
    where: { billingId },
    orderBy: { issuedAt: "desc" },
  });
}
