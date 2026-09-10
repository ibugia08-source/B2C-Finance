"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  ajustarPreferenciaDeCobranca, despacharPelaRegua, registrarEnvioDaRegua, registrarPromessa,
} from "@/lib/services/collection-tasks";
import type { EtapaDaRegua } from "@/lib/collection/regua";

/**
 * AÇÕES DA RÉGUA DE COBRANÇA (F3.9 · 02 §4.3).
 *
 * A régua PRIORIZADA continua inteira — score, cinco degraus, tons e
 * silêncios. O que saiu (simplificação de 10/09/2026) foi o gabarito de fila
 * item-a-item: as mesmas ações agora vivem na LISTA de Inadimplência, por
 * linha e em massa.
 *
 * Nenhuma delas abre formulário quando pode receber o valor pronto — é o que
 * faz cinquenta cobranças caberem numa passada só.
 */

export async function marcarEnviadaAction(
  billingId: string,
  etapa: EtapaDaRegua,
  mensagem?: string
) {
  await requirePermission("recebimentos.gerar_cobranca");
  const { medir } = await import("@/lib/observability");
  const r = await medir("action:regua.marcar-enviada", () =>
    registrarEnvioDaRegua(billingId, etapa, { mensagem })
  );
  revalidatePath("/inadimplencia");
  revalidatePath("/cobrancas");
  return r;
}

/**
 * Envio em 1 clique pelo sistema (F5.1 · 19.17): o clique é humano, a entrega
 * é do provedor. A mensagem vai EXATAMENTE como está na tela — o que o
 * operador leu é o que o cliente recebe.
 */
export async function enviarPeloSistemaAction(
  billingId: string,
  etapa: EtapaDaRegua,
  mensagem: string
) {
  await requirePermission("recebimentos.gerar_cobranca");
  const { medir } = await import("@/lib/observability");
  const r = await medir("action:regua.enviar", () =>
    despacharPelaRegua(billingId, etapa, mensagem)
  );
  revalidatePath("/inadimplencia");
  revalidatePath("/cobrancas");
  return r;
}

/**
 * F5.2 — pede a emissão do link de pagamento. O Outbox leva ao provedor; o
 * link volta pelo webhook e passa a viajar dentro da mensagem da régua.
 */
export async function gerarLinkDePagamentoAction(billingId: string) {
  await requirePermission("recebimentos.gerar_cobranca");
  const { emitirLinkDePagamento } = await import("@/lib/services/gateway-charges");
  const r = await emitirLinkDePagamento(billingId);
  revalidatePath("/inadimplencia");
  revalidatePath("/cobrancas");
  return r;
}

export async function registrarPromessaAction(
  billingId: string,
  dataISO: string,
  observacao?: string
) {
  await requirePermission("recebimentos.gerar_cobranca");
  const data = new Date(dataISO);
  const r = await registrarPromessa(billingId, data, observacao);
  revalidatePath("/inadimplencia");
  revalidatePath("/cobrancas");
  return r;
}

export async function silenciarCobrancaAction(
  clientId: string,
  ateISO: string | null,
  bloqueio?: string | null
) {
  await requirePermission("recebimentos.gerar_cobranca");
  const r = await ajustarPreferenciaDeCobranca(clientId, {
    silencioAte: ateISO ? new Date(ateISO) : null,
    ...(bloqueio !== undefined ? { bloqueio } : {}),
  });
  revalidatePath("/inadimplencia");
  revalidatePath("/clientes");
  return r;
}

/**
 * AÇÃO EM MASSA (a que substitui o "item a item por teclado").
 *
 * Processa as cobranças selecionadas na ordem da lista e devolve o PLACAR —
 * quantas foram, quantas recusaram e por quê. Nunca aborta no primeiro erro:
 * numa passada de cinquenta cobranças, parar na terceira porque um cliente
 * está em silêncio faria a pessoa recomeçar tudo.
 *
 * As recusas legítimas (opt-out, teto de frequência, etapa já enviada)
 * continuam sendo recusas do serviço — o massa não tem atalho para dentro da
 * régua, só chama a mesma porta várias vezes.
 */
export async function despacharEmMassaAction(
  itens: { billingId: string; etapa: EtapaDaRegua; mensagem: string }[],
  modo: "enviar" | "marcar"
) {
  await requirePermission("recebimentos.gerar_cobranca");
  let enviadas = 0;
  const recusas: { billingId: string; erro: string }[] = [];
  for (const item of itens) {
    const r =
      modo === "enviar"
        ? await despacharPelaRegua(item.billingId, item.etapa, item.mensagem)
        : await registrarEnvioDaRegua(item.billingId, item.etapa, { mensagem: item.mensagem });
    if (r.ok) enviadas++;
    else recusas.push({ billingId: item.billingId, erro: r.error });
  }
  revalidatePath("/inadimplencia");
  revalidatePath("/cobrancas");
  return { ok: true as const, enviadas, recusas };
}
