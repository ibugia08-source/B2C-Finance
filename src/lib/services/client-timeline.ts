import { prisma } from "@/lib/prisma";

/**
 * LINHA DO TEMPO UNIFICADA DO CLIENTE (F1.16 · ref. 01 §4.10; 02 §4.1, gabarito 5).
 *
 * As TRÊS trilhas de 01 §4.10 — e a regra de lá é "trilhas EXCLUSIVAS, nada
 * gravado em duas":
 *
 *   AUDITORIA  (AuditLog)          — mudança de dado e ação sensível
 *   COBRANÇA   (CollectionHistory) — contato, promessa, régua
 *   CONTEXTO   (ClientNote)        — o registro humano tipado
 *
 * Este serviço INTERCALA, nunca copia: cada evento continua morando na sua
 * trilha, e a linha do tempo é uma leitura. Auditoria entra pelo Cliente e
 * pelas RELAÇÕES dele — pausar/retomar/reativar (lifecycle.ts) escrevem na
 * relação, e sumir com eles da linha do tempo esconderia justamente os
 * gestos que reescrevem o ciclo de vida.
 */

export type Trilha = "AUDITORIA" | "COBRANCA" | "CONTEXTO";

export type EventoDaLinha = {
  id: string;
  trilha: Trilha;
  quando: Date;
  titulo: string;
  detalhe: string | null;
  autor: string | null;
};

const LIMITE_POR_TRILHA = 200;

export async function linhaDoTempo(clientId: string): Promise<EventoDaLinha[]> {
  const relacoes = await prisma.clientAgencyRelationship.findMany({
    where: { clientId },
    select: { id: true },
  });
  const idsAuditados = [clientId, ...relacoes.map((r) => r.id)];

  const [auditoria, cobranca, notas] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        OR: [
          { entity: "Client", entityId: clientId },
          { entity: "ClientAgencyRelationship", entityId: { in: idsAuditados } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: LIMITE_POR_TRILHA,
      select: {
        id: true, action: true, field: true, oldValue: true, newValue: true,
        reason: true, actorEmail: true, createdAt: true,
      },
    }),
    prisma.collectionHistory.findMany({
      where: { clientId },
      orderBy: { contactedAt: "desc" },
      take: LIMITE_POR_TRILHA,
      select: {
        id: true, status: true, channel: true, message: true, reguaStep: true,
        nextActionAt: true, createdBy: true, contactedAt: true,
      },
    }),
    prisma.clientNote.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: LIMITE_POR_TRILHA,
      select: { id: true, title: true, content: true, type: true, createdAt: true },
    }),
  ]);

  const eventos: EventoDaLinha[] = [];

  for (const a of auditoria) {
    eventos.push({
      id: `aud-${a.id}`,
      trilha: "AUDITORIA",
      quando: a.createdAt,
      titulo:
        a.action === "CREATE"
          ? "Registro criado"
          : a.action === "DELETE"
            ? "Registro removido"
            : a.field
              ? `Alterado: ${a.field}`
              : "Dados alterados",
      detalhe:
        [
          a.field && a.oldValue != null ? `de “${a.oldValue}” para “${a.newValue ?? "—"}”` : null,
          a.reason,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      autor: a.actorEmail,
    });
  }

  const STATUS_COBRANCA: Record<string, string> = {
    CONTACTED: "Contato de cobrança",
    PROMISED: "Promessa de pagamento",
    NO_RESPONSE: "Sem resposta",
    PAID: "Pagamento confirmado no contato",
  };
  for (const c of cobranca) {
    eventos.push({
      id: `cob-${c.id}`,
      trilha: "COBRANCA",
      quando: c.contactedAt,
      titulo:
        (STATUS_COBRANCA[c.status] ?? "Interação de cobrança") +
        (c.reguaStep ? ` (${c.reguaStep})` : ""),
      detalhe:
        [
          c.channel,
          c.nextActionAt
            ? `para ${new Intl.DateTimeFormat("pt-BR").format(c.nextActionAt)}`
            : null,
          c.message ? c.message.slice(0, 140) : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      autor: c.createdBy,
    });
  }

  for (const nota of notas) {
    eventos.push({
      id: `nota-${nota.id}`,
      trilha: "CONTEXTO",
      quando: nota.createdAt,
      titulo: nota.title,
      detalhe: [nota.type, nota.content.slice(0, 180)].filter(Boolean).join(" · ") || null,
      autor: null,
    });
  }

  return eventos.sort((a, b) => b.quando.getTime() - a.quando.getTime());
}
