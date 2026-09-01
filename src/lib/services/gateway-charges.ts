import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { emissaoConfigurada, nomeDoProvedor } from "@/lib/integrations/gateway";

/**
 * EMISSÃO DO LINK DE PAGAMENTO (F5.2 · ref. 03 §4.2; decisão 19.10).
 *
 * O clique pede, o Outbox leva, o provedor emite, o webhook traz o link de
 * volta. Nada aqui espera resposta do provedor: se ele estiver fora do ar, o
 * pedido fica publicado e a entrega tenta de novo com recuo — o operador não
 * fica olhando um spinner que depende do uptime de terceiro.
 *
 * SEM guarda de período de propósito: emitir um link não posta nada em
 * competência nenhuma — é operação de cobrança, como mandar uma mensagem.
 * O dinheiro só encosta no razão quando o webhook de pagamento passar pelo
 * settleBilling, que tem o pipeline inteiro.
 */
export async function emitirLinkDePagamento(
  billingId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!emissaoConfigurada())
    return { ok: false, error: "O link de pagamento ainda não está ativado para a conta." };

  const b = await prisma.billing.findUnique({
    where: { id: billingId },
    select: {
      id: true, description: true, amount: true, paidTotal: true, dueDate: true,
      status: true, canceledAt: true,
      client: { select: { id: true, name: true, document: true, email: true, phone: true } },
    },
  });
  if (!b) return { ok: false, error: "Cobrança não encontrada." };
  if (b.canceledAt) return { ok: false, error: "Esta cobrança foi cancelada." };
  const aberto = Math.round((n(b.amount) - n(b.paidTotal)) * 100) / 100;
  if (aberto <= 0.005) return { ok: false, error: "Esta cobrança já está quitada." };

  const viva = await prisma.gatewayCharge.findFirst({
    where: { billingId: b.id, status: { in: ["PENDING", "ACTIVE"] } },
    select: { id: true, status: true },
  });
  if (viva)
    return {
      ok: false,
      error:
        viva.status === "ACTIVE"
          ? "Esta cobrança já tem um link de pagamento ativo."
          : "O link desta cobrança já está sendo emitido.",
    };

  const { currentWorkspaceId } = await import("@/lib/services/workspace");
  const workspaceId = await currentWorkspaceId().catch(() => null);
  if (!workspaceId)
    return { ok: false, error: "Não foi possível identificar o espaço de trabalho." };

  const { publish } = await import("@/lib/outbox");
  try {
    await prisma.$transaction(async (tx) => {
      const charge = await tx.gatewayCharge.create({
        data: { billingId: b.id, provider: nomeDoProvedor(), status: "PENDING" },
        select: { id: true },
      });
      await publish(tx as any, {
        workspaceId,
        eventType: "GATEWAY_CHARGE_REQUESTED",
        channel: "webhook",
        sourceType: "Billing",
        sourceId: b.id,
        dedupeKey: `GATEWAY_CHARGE_REQUESTED:Billing:${b.id}:${charge.id}`,
        payload: {
          billingId: b.id,
          chargeRef: charge.id,
          valor: aberto,
          vencimento: b.dueDate.toISOString(),
          descricao: b.description,
          cliente: {
            nome: b.client.name,
            documento: b.client.document ?? null,
            email: b.client.email ?? null,
            telefone: b.client.phone ?? null,
          },
        },
      });
    });
  } catch (e: any) {
    // A unique parcial (uma viva por billing) pegou uma corrida de cliques.
    if (e?.code === "P2002" || /GatewayCharge_billing_viva_key/.test(String(e?.message)))
      return { ok: false, error: "O link desta cobrança já está sendo emitido." };
    throw e;
  }
  return { ok: true };
}

/** Links ATIVOS por cobrança — para a mensagem da régua levar o link junto. */
export async function linksDasCobrancas(
  billingIds: string[]
): Promise<Map<string, string>> {
  if (billingIds.length === 0) return new Map();
  const linhas = await prisma.gatewayCharge.findMany({
    where: { billingId: { in: billingIds }, status: "ACTIVE", link: { not: null } },
    select: { billingId: true, link: true },
  });
  return new Map(linhas.map((l) => [l.billingId, l.link!]));
}
