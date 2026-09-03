import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * INTEGRAÇÃO AVANCECRM (F4.8 · ref. 03 §4.2, §4.3; cenário S20).
 *
 * Duas metades que não se misturam, como manda 03 §4.2:
 *
 *   SAÍDA   fato financeiro + OutboxEvent na MESMA transação; a entrega roda
 *           depois, com recuo exponencial e dead-letter.
 *   ENTRADA webhook cai numa CAIXA DE ENTRADA com unique em (origem, id do
 *           evento) e só então é processado.
 *
 * O QUE ESTE ARQUIVO NÃO SABE, e é honesto dizer: **o contrato real de
 * payload do AvanceCRM.** Ele não está nas specs e não há ambiente para
 * descobrir. Então a entrada aceita um envelope MÍNIMO e documentado
 * (`{ id, type, data }`), processa os tipos que sabe e REGISTRA como
 * "ignorado" o que não conhece — em vez de falhar. Registrar e ignorar é o
 * comportamento certo para um webhook de contrato desconhecido: falhar faria
 * o provedor reenviar para sempre, e aceitar em silêncio esconderia que
 * chegou coisa que ninguém trata.
 *
 * Quando o contrato real aparecer, o que muda é `processar()`. O envelope, a
 * assinatura e a idempotência continuam valendo.
 */

export const FONTE = "avancecrm";

/**
 * Depois disto, uma linha ainda em RECEIVED é considerada ABANDONADA (o
 * processo que a segurava morreu) e volta a ser reprocessável.
 */
const JANELA_DE_ABANDONO_MS = 5 * 60 * 1000;

export type EnvelopeDeWebhook = {
  /** Identificador do evento NA ORIGEM. É a chave de idempotência. */
  id: string;
  type: string;
  data?: Record<string, unknown>;
};

export type ResultadoDaEntrada =
  | { ok: true; situacao: "PROCESSADO" | "IGNORADO" | "REPETIDO"; nota?: string }
  | { ok: false; error: string; status: number };

/** Tipos que o produto sabe tratar hoje. */
export const TIPOS_CONHECIDOS = ["lead.created", "lead.updated"] as const;

// ---------------------------------------------------------------------------
// Assinatura
// ---------------------------------------------------------------------------

/**
 * HMAC-SHA256 do corpo CRU com o segredo compartilhado.
 *
 * Do corpo cru e não do JSON reserializado: reserializar muda espaços e ordem
 * de chaves, e a assinatura deixa de bater por um motivo que ninguém acha.
 */
export function assinar(corpo: string, segredo: string): string {
  return createHmac("sha256", segredo).update(corpo, "utf8").digest("hex");
}

/**
 * Comparação em TEMPO CONSTANTE. Comparar com `===` vaza, pelo tempo de
 * resposta, quantos caracteres iniciais estão certos — e um atacante
 * descobre a assinatura byte a byte.
 */
export function assinaturaConfere(corpo: string, assinatura: string, segredo: string): boolean {
  const esperada = Buffer.from(assinar(corpo, segredo), "hex");
  let recebida: Buffer;
  try {
    recebida = Buffer.from(assinatura.replace(/^sha256=/, ""), "hex");
  } catch {
    return false;
  }
  if (recebida.length !== esperada.length) return false;
  return timingSafeEqual(recebida, esperada);
}

export function segredoConfigurado(): string | null {
  const s = process.env.AVANCECRM_WEBHOOK_SECRET;
  return s && s.length >= 16 ? s : null;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/**
 * Recebe um evento. Devolve sempre uma resposta que o provedor entende —
 * inclusive para o repetido, que é 200, porque do ponto de vista dele o
 * evento CHEGOU.
 */
export async function receberEvento(
  corpo: string,
  assinatura: string | null
): Promise<ResultadoDaEntrada> {
  const segredo = segredoConfigurado();
  if (!segredo)
    return {
      ok: false,
      status: 503,
      error: "Integração não configurada. Defina AVANCECRM_WEBHOOK_SECRET.",
    };
  if (!assinatura || !assinaturaConfere(corpo, assinatura, segredo))
    return { ok: false, status: 401, error: "Assinatura inválida." };

  let envelope: EnvelopeDeWebhook;
  try {
    envelope = JSON.parse(corpo);
  } catch {
    return { ok: false, status: 400, error: "Corpo não é JSON." };
  }
  if (!envelope?.id || !envelope?.type)
    return { ok: false, status: 400, error: "O evento precisa de `id` e `type`." };

  const workspaceId = await currentWorkspaceId();

  // A UNIQUE de (source, eventId) é a idempotência. O reenvio bate aqui.
  let inbox: { id: string };
  try {
    inbox = await runWithoutScope(async () =>
      prisma.webhookInbox.create({
        data: {
          workspaceId,
          source: FONTE,
          eventId: envelope.id,
          eventType: envelope.type,
          payload: (envelope.data ?? {}) as any,
          // Nasce PROCESSANDO: quem inseriu a linha é o dono do trabalho.
          // É o que separa "ninguém pegou este evento" de "alguém está com
          // ele agora" — sem isso, entregas simultâneas se veem como
          // "sem desfecho" e aplicam o mesmo fato N vezes.
          status: "PROCESSANDO",
        },
        select: { id: true },
      })
    );
  } catch (e: any) {
    if (e?.code !== "P2002") throw e;

    // REPETIDO NÃO É SINÔNIMO DE JÁ RESOLVIDO, e confundir os dois PERDE
    // eventos em silêncio: se a primeira tentativa entrou na caixa e falhou
    // ao processar, responder "repetido" ao reenvio deixaria o fato nunca
    // aplicado — com 200 na cara do provedor, que nunca mais tenta.
    //
    // Só é repetição de verdade quando a primeira já teve DESFECHO.
    const anterior = await runWithoutScope(async () =>
      prisma.webhookInbox.findUnique({
        where: { source_eventId: { source: FONTE, eventId: envelope.id } },
        select: { id: true, status: true },
      })
    );
    if (!anterior) throw e;
    if (anterior.status === "PROCESSED" || anterior.status === "IGNORED") {
      return { ok: true, situacao: "REPETIDO" };
    }

    // AINDA EM VOO ≠ LIVRE PARA REPROCESSAR. Dez entregas simultâneas do
    // mesmo evento: uma cria a linha e as outras nove caem aqui com ela
    // ainda RECEIVED. Se todas seguissem, o fato seria aplicado dez vezes
    // (dez leads do mesmo lead) — a unique da caixa não protege o
    // PROCESSAMENTO, só a linha.
    //
    // A reivindicação é um UPDATE condicional, que o Postgres resolve
    // atomicamente: só quem TROCA o status leva o evento. Quem não levou
    // responde REPETIDO — o dono legítimo vai chegar a um desfecho.
    // FAILED continua reprocessável, e RECEIVED velho também: é o processo
    // que morreu no meio e não vai mais terminar.
    const limite = new Date(Date.now() - JANELA_DE_ABANDONO_MS);
    const reivindicou = await runWithoutScope(async () =>
      prisma.webhookInbox.updateMany({
        where: {
          id: anterior.id,
          OR: [
            // Sem dono: linha órfã (entrou por fora) ou tentativa encerrada
            // em erro — as duas são reprocessáveis.
            { status: { in: ["RECEIVED", "FAILED"] } },
            // Dono que sumiu: processo morreu segurando o evento.
            { status: "PROCESSANDO", receivedAt: { lt: limite } },
          ],
        },
        data: { status: "PROCESSANDO", receivedAt: new Date(), processedAt: null },
      })
    );
    if (reivindicou.count === 0) return { ok: true, situacao: "REPETIDO" };
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
    // A linha fica FAILED com o motivo, e o 500 faz o provedor reenviar — o
    // reenvio cai no caminho de cima e TENTA DE NOVO, porque não houve
    // desfecho.
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

/**
 * Processa SOB O DONO DA CONTA.
 *
 * Webhook não tem usuário logado, e a extensão de dono do Prisma falha
 * fechada: sem dono resolvido ela grava `__no_owner__` e a chave estrangeira
 * recusa. O lead que chega do CRM pertence ao dono da conta — é a única
 * resposta possível, e foi o smoke test autenticado que mostrou isso (o teste
 * de unidade rodava dentro de um dono e não via o problema).
 */
async function processarComDono(
  workspaceId: string,
  envelope: EnvelopeDeWebhook
): Promise<{ situacao: "PROCESSADO" | "IGNORADO"; nota?: string }> {
  const ws = await runWithoutScope(async () =>
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } })
  );
  if (!ws?.ownerId) {
    return {
      situacao: "IGNORADO",
      nota: "A conta não tem dono definido — o evento fica guardado até ter.",
    };
  }
  const { runWithOwner } = await import("@/lib/auth/owner-scope");
  return runWithOwner(ws.ownerId, () => processar(envelope));
}

async function processar(
  e: EnvelopeDeWebhook
): Promise<{ situacao: "PROCESSADO" | "IGNORADO"; nota?: string }> {
  if (!(TIPOS_CONHECIDOS as readonly string[]).includes(e.type)) {
    return {
      situacao: "IGNORADO",
      nota: `Tipo “${e.type}” não é tratado pelo produto. O evento fica guardado.`,
    };
  }

  const d = (e.data ?? {}) as Record<string, any>;
  const nome = String(d.name ?? d.nome ?? "").trim();
  if (!nome) return { situacao: "IGNORADO", nota: "Evento de lead sem nome." };

  const { criarLead } = await import("@/lib/services/leads");
  const r = await criarLead({
    name: nome,
    company: d.company ?? d.empresa ?? null,
    phone: d.phone ?? d.telefone ?? null,
    email: d.email ?? null,
    document: d.document ?? d.documento ?? null,
    niche: d.niche ?? d.nicho ?? null,
    channel: d.channel ?? d.canal ?? null,
    campaign: d.campaign ?? d.campanha ?? null,
    source: FONTE,
    sdr: d.sdr ?? null,
  });
  return r.ok
    ? { situacao: "PROCESSADO", nota: `Lead ${r.lead.id} criado.` }
    : { situacao: "IGNORADO", nota: r.error };
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

export function urlConfigurada(): string | null {
  const u = process.env.AVANCECRM_WEBHOOK_URL;
  return u && /^https?:\/\//.test(u) ? u : null;
}

/**
 * Entregador do canal `crm` para o worker do Outbox.
 *
 * LANÇA quando não entrega — é o contrato do worker: exceção significa "não
 * entregou" e ele reagenda com recuo. Devolver silenciosamente marcaria como
 * entregue o que ficou pelo caminho.
 */
export async function entregarNoCrm(evento: {
  id: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  payload: unknown;
}): Promise<void> {
  const url = urlConfigurada();
  const segredo = segredoConfigurado();
  if (!url || !segredo)
    throw new Error("Integração de saída não configurada (URL ou segredo ausente).");

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
      // Mesma assinatura que exigimos na entrada: um formato só nos dois
      // sentidos é um a menos para depurar às três da manhã.
      "x-b2c-signature": `sha256=${assinar(corpo, segredo)}`,
      // O provedor usa isto para deduplicar do lado dele.
      "x-b2c-event-id": evento.id,
    },
    body: corpo,
  });

  if (!resposta.ok) {
    throw new Error(`AvanceCRM respondeu ${resposta.status}.`);
  }
}
