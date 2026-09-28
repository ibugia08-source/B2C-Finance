import { z } from "zod";
import { CollectionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type DomainContext, type DomainResult, inDomain } from "@/lib/engines/domain";

/**
 * CONTATO E OBSERVAÇÃO DE COBRANÇA — regra de domínio (extraída de
 * actions/billings.ts em 27/09/2026, sem mudança de comportamento). A
 * interface e a futura API registram o contato pela mesma função.
 * Não invalida cache: quem chama chama `revalidateAgency({ clientId })`.
 */

export type ContatoDeCobrancaInput = {
  billingId: string;
  channel: "whatsapp" | "copia";
  /** Trecho da mensagem enviada/copiada (guardado até 180 caracteres). */
  excerpt: string;
};

/** A mensagem de cobrança foi enviada/copiada: histórico + cliente contatado. */
export async function registrarContatoDeCobranca(
  ctx: DomainContext,
  input: ContatoDeCobrancaInput
): Promise<DomainResult<{ clientId?: string }>> {
  return inDomain(ctx, async () => {
    const b = await prisma.billing.findUnique({ where: { id: input.billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    await prisma.collectionHistory.create({
      data: {
        billingId: b.id,
        clientId: b.clientId,
        status: "CONTACTED",
        channel: input.channel,
        message:
          input.channel === "whatsapp"
            ? `Cobrança enviada via WhatsApp: "${input.excerpt.slice(0, 180)}…"`
            : `Mensagem de cobrança copiada: "${input.excerpt.slice(0, 180)}…"`,
      },
    });
    if (b.collectionStatus === "NOT_CONTACTED") {
      await prisma.billing.update({
        where: { id: b.id },
        data: { collectionStatus: "CONTACTED" },
      });
    }
    return { ok: true, clientId: b.clientId };
  });
}

export const NotaDeCobrancaInputSchema = z.object({
  billingId: z.string().min(1),
  status: z.nativeEnum(CollectionStatus),
  channel: z.string().trim().nullable(),
  message: z.string().trim().min(1, "Escreva a observação."),
  nextActionAt: z.date().nullable(),
});
export type NotaDeCobrancaInput = z.input<typeof NotaDeCobrancaInputSchema>;

/** Observação de cobrança com novo estado e próxima ação. */
export async function registrarNotaDeCobranca(
  ctx: DomainContext,
  input: NotaDeCobrancaInput
): Promise<DomainResult<{ clientId?: string }>> {
  const parsed = NotaDeCobrancaInputSchema.parse(input);
  return inDomain(ctx, async () => {
    const b = await prisma.billing.findUnique({ where: { id: parsed.billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    await prisma.collectionHistory.create({
      data: {
        billingId: b.id,
        clientId: b.clientId,
        status: parsed.status,
        channel: parsed.channel,
        message: parsed.message,
        nextActionAt: parsed.nextActionAt,
      },
    });
    await prisma.billing.update({
      where: { id: b.id },
      data: { collectionStatus: parsed.status },
    });
    return { ok: true, clientId: b.clientId };
  });
}
