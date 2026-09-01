import { prisma } from "@/lib/prisma";
import {
  apenasDigitos, documentoValido, semelhanca, type Semelhanca,
} from "@/lib/commercial/dedupe";
import type { LeadStatus } from "@prisma/client";

/**
 * LEADS E CONVERSÃO (F4.1 · ref. 01 §4.6).
 *
 * A conversão é o ponto onde a carteira ganha ou perde integridade. Os três
 * desfechos possíveis estão aqui, e são desfechos DIFERENTES de propósito:
 *
 *   NOVO      — documento não existe na carteira: nasce um cliente.
 *   EXISTENTE — mesmo documento: liga ao cliente que já existe, sem duplicar.
 *   REATIVADO — mesmo documento, cliente CHURNED: volta na MESMA ficha, com
 *               o histórico inteiro (01 §4.6: "churnado reativa sem duplicar").
 *
 * O que o sistema NÃO faz sozinho é fundir por nome ou telefone parecidos.
 * Isso vira sugestão para uma pessoa decidir, porque fundir dois clientes de
 * verdade é o dano mais caro e mais difícil de desfazer da carteira.
 */

export type DesfechoDaConversao = "NOVO" | "EXISTENTE" | "REATIVADO";

export type SugestaoDeDuplicata = {
  clientId: string;
  nome: string;
  status: string;
  score: number;
  motivo: string;
};

export type AnaliseDeConversao = {
  /** Cliente com o MESMO documento — ligação automática, sem perguntar. */
  mesmoDocumento: { id: string; name: string; status: string } | null;
  /** Parecidos por nome ou telefone — precisam de gente. */
  sugestoes: SugestaoDeDuplicata[];
  desfechoPrevisto: DesfechoDaConversao;
};

/** O que a tela mostra ANTES de converter. Só leitura. */
export async function analisarConversao(leadId: string): Promise<AnaliseDeConversao | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, name: true, company: true, phone: true, documentDigits: true },
  });
  if (!lead) return null;

  const digitos = lead.documentDigits;
  const mesmoDocumento = documentoValido(digitos)
    ? await acharPorDocumento(digitos!)
    : null;

  // Nome do lead para comparar: a empresa, quando há — é ela que vira cliente.
  const nomeDoLead = lead.company?.trim() || lead.name;

  // Só procuramos parecidos quando NÃO há casamento por documento: com
  // documento igual a resposta já é definitiva, e mostrar sugestões ao lado
  // dela só criaria dúvida onde não há.
  const sugestoes: SugestaoDeDuplicata[] = [];
  if (!mesmoDocumento) {
    const candidatos = await prisma.client.findMany({
      select: { id: true, name: true, legalName: true, phone: true, status: true },
      take: 2000,
    });
    for (const c of candidatos) {
      const s: Semelhanca | null =
        semelhanca({ nome: nomeDoLead, telefone: lead.phone }, { nome: c.name, telefone: c.phone }) ??
        (c.legalName
          ? semelhanca({ nome: nomeDoLead, telefone: lead.phone }, { nome: c.legalName, telefone: c.phone })
          : null);
      if (s) sugestoes.push({ clientId: c.id, nome: c.name, status: c.status, score: s.score, motivo: s.motivo });
    }
    sugestoes.sort((a, b) => b.score - a.score);
  }

  return {
    mesmoDocumento,
    sugestoes: sugestoes.slice(0, 5),
    desfechoPrevisto: !mesmoDocumento
      ? "NOVO"
      : mesmoDocumento.status === "CHURNED"
        ? "REATIVADO"
        : "EXISTENTE",
  };
}

async function acharPorDocumento(digitos: string) {
  // O cadastro do cliente guarda o documento formatado; a comparação tem de
  // ser por dígitos dos dois lados, senão o mesmo CNPJ escapa por causa de um
  // ponto. Feito em SQL para não trazer a carteira inteira para a memória.
  const linhas = await prisma.$queryRaw<{ id: string; name: string; status: string }[]>`
    SELECT "id", "name", "status"::text
      FROM "Client"
     WHERE regexp_replace(coalesce("document", ''), '\\D', '', 'g') = ${digitos}
     ORDER BY "createdAt" ASC
     LIMIT 1
  `;
  return linhas[0] ?? null;
}

export type EntradaDeLead = {
  name: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  document?: string | null;
  niche?: string | null;
  agencyId?: string | null;
  channel?: string | null;
  campaign?: string | null;
  source?: string | null;
  sdr?: string | null;
  indicadoPor?: string | null;
  solicitadoPor?: string | null;
};

export async function criarLead(input: EntradaDeLead) {
  const nome = input.name.trim();
  if (nome.length < 2) return { ok: false as const, error: "Informe o nome do contato." };

  const digitos = apenasDigitos(input.document);
  return {
    ok: true as const,
    lead: await prisma.lead.create({
      data: {
        ...input,
        name: nome,
        document: input.document?.trim() || null,
        // Guardamos os dígitos SÓ quando formam um documento válido: dígito
        // solto viraria chave de deduplicação e casaria empresas sem relação.
        documentDigits: documentoValido(digitos) ? digitos : null,
      },
      select: { id: true, name: true },
    }),
  };
}

export type ResultadoDaConversao =
  | { ok: true; clientId: string; desfecho: DesfechoDaConversao }
  | { ok: false; error: string };

/**
 * Converte o lead em cliente.
 *
 * `clientIdEscolhido` existe para a pessoa poder aceitar uma SUGESTÃO: quando
 * ela diz "é este cliente aqui", a conversão liga ao escolhido em vez de
 * criar um novo. Sem esse caminho, a sugestão seria só um aviso decorativo.
 */
export async function converterLead(
  leadId: string,
  opts: { clientIdEscolhido?: string | null; agencyId?: string | null } = {}
): Promise<ResultadoDaConversao> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, name: true, company: true, phone: true, email: true,
      document: true, documentDigits: true, niche: true, agencyId: true,
      status: true, source: true, indicadoPor: true,
    },
  });
  if (!lead) return { ok: false, error: "Lead não encontrado." };
  if (lead.status === "CONVERTED")
    return { ok: false, error: "Este lead já virou cliente." };

  const porDocumento = documentoValido(lead.documentDigits)
    ? await acharPorDocumento(lead.documentDigits!)
    : null;
  // O documento MANDA sobre a escolha manual: se o CNPJ é de outro cliente,
  // ligar ao escolhido criaria dois cadastros com o mesmo documento.
  const alvo =
    porDocumento ??
    (opts.clientIdEscolhido
      ? await prisma.client.findUnique({
          where: { id: opts.clientIdEscolhido },
          select: { id: true, name: true, status: true },
        })
      : null);

  const { contextFromRequest } = await import("@/lib/engines/context");
  const { auditEvent } = await import("@/lib/audit");
  const ctx = await contextFromRequest();

  return prisma.$transaction(async (tx) => {
    let clientId: string;
    let desfecho: DesfechoDaConversao;

    if (alvo) {
      desfecho = alvo.status === "CHURNED" ? "REATIVADO" : "EXISTENTE";
      clientId = alvo.id;
      if (desfecho === "REATIVADO") {
        // Volta na MESMA ficha: histórico, cobranças antigas e avaliações
        // continuam ali. Criar cadastro novo perderia o passado inteiro e
        // faria o churn do ano passado sumir das métricas de retenção.
        await tx.client.update({
          where: { id: clientId },
          data: { status: "ACTIVE", churnedAt: null },
        });
      }
    } else {
      desfecho = "NOVO";
      const criado = await tx.client.create({
        data: {
          name: lead.company?.trim() || lead.name,
          document: lead.document,
          phone: lead.phone,
          email: lead.email,
          segment: lead.niche,
          origin: lead.source ?? (lead.indicadoPor ? "indicação" : null),
          status: "PROSPECT",
        },
        select: { id: true },
      });
      clientId = criado.id;
    }

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: "CONVERTED" as LeadStatus,
        convertedClientId: clientId,
        convertedAt: new Date(),
      },
    });

    await auditEvent(tx as any, "Lead", lead.id, "CREATE", {
      ...ctx,
      reason: `Lead convertido (${desfecho.toLowerCase()}) no cliente ${clientId}.`,
    });

    return { ok: true as const, clientId, desfecho };
  });
}
