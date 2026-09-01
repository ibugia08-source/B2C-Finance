import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { assinar, assinaturaConfere } from "@/lib/integrations/avancecrm";

/**
 * GATEWAY DE PAGAMENTO — Pix e boleto (F5.2 · ref. 03 §4.2, §4.3; decisão 19.10).
 *
 * A decisão 19.10 mandou NÃO antecipar: o gateway é assunto da Fase 5, e a
 * Fase 5 chegou. O que este módulo NÃO decide é qual provedor será usado —
 * isso é contrato comercial, não código. Por isso ele é agnóstico: um
 * envelope mínimo documentado, o MESMO formato de assinatura HMAC dos dois
 * sentidos que o AvanceCRM já usa, e o nome do provedor em configuração.
 *
 * O CORAÇÃO FINANCEIRO não mora aqui de propósito: a baixa automática entra
 * pelo settleBilling — o MESMO pipeline (permissão → período → idempotência →
 * Payment → razão → auditoria) do pagamento manual. Um webhook não ganha
 * atalho para dentro do caixa; ele ganha uma porta com a mesma fechadura.
 *
 * Configuração:
 *   GATEWAY_WEBHOOK_SECRET — assinatura HMAC (entrada e saída).
 *   GATEWAY_API_URL        — para onde o worker entrega os pedidos de emissão.
 *   GATEWAY_PROVIDER       — nome do provedor contratado (rótulo dos registros).
 */

export const FONTE_GATEWAY = "gateway";

export const TIPOS_DO_GATEWAY = ["charge.created", "charge.paid", "charge.canceled"] as const;

export type EnvelopeDoGateway = {
  id: string;
  type: string;
  data?: Record<string, unknown>;
};

export function segredoDoGateway(): string | null {
  const s = process.env.GATEWAY_WEBHOOK_SECRET;
  return s && s.length >= 16 ? s : null;
}

export function urlDoGateway(): string | null {
  const u = process.env.GATEWAY_API_URL;
  return u && /^https?:\/\//.test(u) ? u : null;
}

export function nomeDoProvedor(): string {
  return (process.env.GATEWAY_PROVIDER ?? "").trim() || FONTE_GATEWAY;
}

/** Emissão de link exige os DOIS lados: para onde pedir e como assinar. */
export function emissaoConfigurada(): boolean {
  return !!urlDoGateway() && !!segredoDoGateway();
}

export type ResultadoDoGateway =
  | { ok: true; situacao: "PROCESSADO" | "IGNORADO" | "REPETIDO"; nota?: string }
  | { ok: false; status: number; error: string };

/**
 * Entrada de webhook do gateway — o MESMO desenho da entrada do AvanceCRM,
 * porque as lições de lá valem aqui dobradas (é dinheiro):
 *
 *  - a assinatura é do corpo CRU, conferida em tempo constante;
 *  - a UNIQUE (source, eventId) da caixa de entrada é a idempotência;
 *  - repetido só é repetido quando a primeira tentativa teve DESFECHO —
 *    responder "repetido" a uma tentativa que falhou perderia o pagamento
 *    em silêncio, com 200 na cara do provedor.
 */
export async function receberEventoDoGateway(
  corpo: string,
  assinatura: string | null
): Promise<ResultadoDoGateway> {
  const segredo = segredoDoGateway();
  if (!segredo)
    return { ok: false, status: 503, error: "Integração não configurada. Defina GATEWAY_WEBHOOK_SECRET." };
  if (!assinatura || !assinaturaConfere(corpo, assinatura, segredo))
    return { ok: false, status: 401, error: "Assinatura inválida." };

  let envelope: EnvelopeDoGateway;
  try {
    envelope = JSON.parse(corpo);
  } catch {
    return { ok: false, status: 400, error: "Corpo não é JSON." };
  }
  if (!envelope?.id || !envelope?.type)
    return { ok: false, status: 400, error: "O evento precisa de `id` e `type`." };

  const workspaceId = await currentWorkspaceId();

  let inbox: { id: string };
  try {
    inbox = await runWithoutScope(async () =>
      prisma.webhookInbox.create({
        data: {
          workspaceId,
          source: FONTE_GATEWAY,
          eventId: envelope.id,
          eventType: envelope.type,
          payload: (envelope.data ?? {}) as any,
        },
        select: { id: true },
      })
    );
  } catch (e: any) {
    if (e?.code !== "P2002") throw e;
    const anterior = await runWithoutScope(async () =>
      prisma.webhookInbox.findUnique({
        where: { source_eventId: { source: FONTE_GATEWAY, eventId: envelope.id } },
        select: { id: true, status: true },
      })
    );
    if (!anterior) throw e;
    if (anterior.status === "PROCESSED" || anterior.status === "IGNORED") {
      return { ok: true, situacao: "REPETIDO" };
    }
    inbox = { id: anterior.id };
  }

  try {
    const r = await processarComDono(workspaceId, envelope);
    await runWithoutScope(async () =>
      prisma.webhookInbox.update({
        where: { id: inbox.id },
        data: {
          status: r.situacao === "PROCESSADO" ? "PROCESSED" : "IGNORED",
          note: r.nota ?? null,
          processedAt: new Date(),
        },
      })
    );
    return { ok: true, ...r };
  } catch (erro: any) {
    await runWithoutScope(async () =>
      prisma.webhookInbox.update({
        where: { id: inbox.id },
        data: {
          status: "FAILED",
          note: String(erro?.message ?? erro).slice(0, 500),
          processedAt: new Date(),
        },
      })
    );
    throw erro;
  }
}

/** Webhook não tem login: o fato pertence ao dono da conta (lição da F4.8). */
async function processarComDono(
  workspaceId: string,
  envelope: EnvelopeDoGateway
): Promise<{ situacao: "PROCESSADO" | "IGNORADO"; nota?: string }> {
  const ws = await runWithoutScope(async () =>
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } })
  );
  if (!ws?.ownerId) {
    return { situacao: "IGNORADO", nota: "A conta não tem dono definido — o evento fica guardado até ter." };
  }
  const { runWithOwner } = await import("@/lib/auth/owner-scope");
  return runWithOwner(ws.ownerId, () => processar(envelope));
}

async function processar(
  e: EnvelopeDoGateway
): Promise<{ situacao: "PROCESSADO" | "IGNORADO"; nota?: string }> {
  if (!(TIPOS_DO_GATEWAY as readonly string[]).includes(e.type)) {
    return { situacao: "IGNORADO", nota: `Tipo “${e.type}” não é tratado pelo produto. O evento fica guardado.` };
  }
  const d = (e.data ?? {}) as Record<string, any>;

  if (e.type === "charge.created") return chargeCriada(d);
  if (e.type === "charge.canceled") return chargeCancelada(d);
  return chargePaga(e.id, d);
}

/** O provedor emitiu o link: a linha PENDENTE vira ATIVA, com id e link. */
async function chargeCriada(d: Record<string, any>) {
  const billingId = String(d.billingId ?? "").trim();
  const chargeId = String(d.chargeId ?? "").trim();
  const link = String(d.link ?? "").trim() || null;
  if (!billingId || !chargeId)
    return { situacao: "IGNORADO" as const, nota: "Evento sem billingId ou chargeId." };

  const billing = await prisma.billing.findUnique({ where: { id: billingId }, select: { id: true } });
  if (!billing)
    return { situacao: "IGNORADO" as const, nota: `A cobrança ${billingId} não existe aqui.` };

  const viva = await prisma.gatewayCharge.findFirst({
    where: { billingId, status: { in: ["PENDING", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (viva) {
    await prisma.gatewayCharge.update({
      where: { id: viva.id },
      data: { chargeId, link, status: "ACTIVE" },
    });
  } else {
    // Cobrança criada direto no painel do provedor: registramos do mesmo
    // jeito — recusar deixaria o link existir lá e o sistema cego aqui.
    await prisma.gatewayCharge.create({
      data: { billingId, provider: nomeDoProvedor(), chargeId, link, status: "ACTIVE" },
    });
  }
  return { situacao: "PROCESSADO" as const, nota: `Link emitido para a cobrança ${billingId}.` };
}

async function chargeCancelada(d: Record<string, any>) {
  const chargeId = String(d.chargeId ?? "").trim();
  if (!chargeId) return { situacao: "IGNORADO" as const, nota: "Evento sem chargeId." };
  const linha = await prisma.gatewayCharge.findFirst({
    where: { chargeId, status: { in: ["PENDING", "ACTIVE"] } },
    select: { id: true },
  });
  if (!linha)
    return { situacao: "IGNORADO" as const, nota: `Nenhum link vivo com o id ${chargeId}.` };
  await prisma.gatewayCharge.update({ where: { id: linha.id }, data: { status: "CANCELED" } });
  return { situacao: "PROCESSADO" as const, nota: "Link cancelado." };
}

/**
 * A BAIXA AUTOMÁTICA IDEMPOTENTE — o motivo de a F5.2 existir.
 *
 * O evento entra pelo settleBilling com (externalSource, externalId): o MESMO
 * pagamento reenviado — mesmo com OUTRO eventId de webhook — registra UMA
 * baixa, porque a identidade do fato é do pagamento no provedor, não da
 * notificação. Recusa do pipeline (mês do caixa fechado, por exemplo) vira
 * FALHA com reprocesso, nunca desfecho silencioso.
 */
async function chargePaga(eventId: string, d: Record<string, any>) {
  const chargeId = String(d.chargeId ?? "").trim();
  const valor = Number(d.amount ?? d.valor ?? NaN);
  const pagoEm = d.paidAt ? new Date(String(d.paidAt)) : new Date();
  if (!Number.isFinite(valor) || valor <= 0)
    return { situacao: "IGNORADO" as const, nota: "Evento de pagamento sem valor." };
  if (Number.isNaN(pagoEm.getTime()))
    return { situacao: "IGNORADO" as const, nota: "Data de pagamento ilegível." };

  const charge = chargeId
    ? await prisma.gatewayCharge.findFirst({
        where: { chargeId },
        orderBy: { createdAt: "desc" },
        select: { id: true, billingId: true },
      })
    : null;
  const billingId = charge?.billingId ?? String(d.billingId ?? "").trim();
  if (!billingId)
    return { situacao: "IGNORADO" as const, nota: "Pagamento sem cobrança correspondente aqui." };

  const metodo = String(d.method ?? "").toLowerCase() === "boleto" ? "BOLETO" : "PIX";
  const { settleBilling } = await import("@/lib/engines/payment-engine");
  const r = await settleBilling(
    {
      billingId,
      amount: Math.round(valor * 100) / 100,
      paidAt: pagoEm,
      method: metodo,
      accountId: null,
      notes: "Baixa automática do link de pagamento.",
    },
    {
      externalSource: FONTE_GATEWAY,
      externalId: String(d.paymentId ?? d.pagamentoId ?? eventId),
      reason: "Pagamento confirmado pelo provedor.",
    }
  );

  if (!r.ok) {
    // Repetição do MESMO pagamento é sucesso do ponto de vista do provedor.
    if (/já foi registrado/i.test(r.error))
      return { situacao: "PROCESSADO" as const, nota: "Pagamento já registrado antes." };
    // Qualquer outra recusa (período, validação) precisa de reprocesso.
    throw new Error(r.error);
  }

  if (charge && r.fullyPaid) {
    await prisma.gatewayCharge.update({ where: { id: charge.id }, data: { status: "PAID" } });
  }
  return {
    situacao: "PROCESSADO" as const,
    nota: r.fullyPaid ? "Cobrança quitada." : "Pagamento parcial registrado.",
  };
}

/**
 * Entregador do canal `webhook` para o worker do Outbox: leva o pedido de
 * emissão ao provedor, assinado do MESMO jeito que exigimos na entrada.
 */
export async function entregarNoGateway(evento: {
  id: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  payload: unknown;
}): Promise<void> {
  const url = urlDoGateway();
  const segredo = segredoDoGateway();
  if (!url || !segredo)
    throw new Error("Gateway não configurado (GATEWAY_API_URL/GATEWAY_WEBHOOK_SECRET).");

  const corpo = JSON.stringify({
    id: evento.id,
    type: evento.eventType,
    source: { type: evento.sourceType, id: evento.sourceId },
    data: evento.payload,
  });
  const resposta = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-b2c-signature": `sha256=${assinar(corpo, segredo)}`,
      "x-b2c-event-id": evento.id,
    },
    body: corpo,
  });
  if (!resposta.ok) throw new Error(`O gateway respondeu ${resposta.status}.`);
}
