import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { assinaturaConfere } from "@/lib/integrations/avancecrm";

/** Linha em RECEIVED mais velha que isto = processo morto; volta a ser reprocessável. */
const JANELA_DE_ABANDONO_MS = 5 * 60 * 1000;

/**
 * CAIXA DE ENTRADA DE WEBHOOK, GENÉRICA (F5.3 · ref. 03 §4.2, §4.3).
 *
 * Terceira integração de entrada (AvanceCRM, gateway, Open Finance) = hora de
 * o desenho virar UM lugar. As regras que valem para todas, aprendidas uma a
 * uma na F4.8:
 *
 *  - a assinatura é do corpo CRU, conferida em tempo constante;
 *  - a UNIQUE (source, eventId) da caixa é a idempotência (S20);
 *  - REPETIDO só é repetido quando a primeira tentativa teve DESFECHO —
 *    responder "repetido" a uma que falhou perde o evento em silêncio;
 *  - o processamento roda sob o DONO da conta (webhook não tem login);
 *  - falha marca FAILED com o motivo e estoura para a rota devolver 500 —
 *    o provedor reenvia, e o reenvio TENTA DE NOVO.
 *
 * O AvanceCRM (F4.8) é anterior a este arquivo e mantém a cópia dele — é o
 * original de onde estas regras saíram.
 */

export type EnvelopeGenerico = { id: string; type: string; data?: Record<string, unknown> };

export type Desfecho = { situacao: "PROCESSADO" | "IGNORADO"; nota?: string };

export type ResultadoDaCaixa =
  | { ok: true; situacao: "PROCESSADO" | "IGNORADO" | "REPETIDO"; nota?: string }
  | { ok: false; status: number; error: string };

export async function receberNaCaixa(opts: {
  fonte: string;
  segredo: string | null;
  erroDeConfiguracao: string;
  corpo: string;
  assinatura: string | null;
  processar: (envelope: EnvelopeGenerico) => Promise<Desfecho>;
}): Promise<ResultadoDaCaixa> {
  if (!opts.segredo) return { ok: false, status: 503, error: opts.erroDeConfiguracao };
  if (!opts.assinatura || !assinaturaConfere(opts.corpo, opts.assinatura, opts.segredo))
    return { ok: false, status: 401, error: "Assinatura inválida." };

  let envelope: EnvelopeGenerico;
  try {
    envelope = JSON.parse(opts.corpo);
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
          source: opts.fonte,
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
    const anterior = await runWithoutScope(async () =>
      prisma.webhookInbox.findUnique({
        where: { source_eventId: { source: opts.fonte, eventId: envelope.id } },
        select: { id: true, status: true },
      })
    );
    if (!anterior) throw e;
    if (anterior.status === "PROCESSED" || anterior.status === "IGNORED") {
      return { ok: true, situacao: "REPETIDO" };
    }

    // Entregas SIMULTÂNEAS do mesmo evento: a unique protege a linha, não o
    // processamento. Sem reivindicar, todas as concorrentes veriam RECEIVED,
    // concluiriam "sem desfecho" e aplicariam o fato N vezes. O UPDATE
    // condicional é atômico no Postgres: só quem troca o status leva.
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
    const r = await processarComDono(workspaceId, envelope, opts.processar);
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

async function processarComDono(
  workspaceId: string,
  envelope: EnvelopeGenerico,
  processar: (envelope: EnvelopeGenerico) => Promise<Desfecho>
): Promise<Desfecho> {
  const ws = await runWithoutScope(async () =>
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } })
  );
  if (!ws?.ownerId) {
    return { situacao: "IGNORADO", nota: "A conta não tem dono definido — o evento fica guardado até ter." };
  }
  const { runWithOwner } = await import("@/lib/auth/owner-scope");
  return runWithOwner(ws.ownerId, () => processar(envelope));
}
