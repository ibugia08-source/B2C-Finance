import { prisma } from "@/lib/prisma";
import { toNumber as n, formatBRL } from "@/lib/format";
import { buildBillingMessage, whatsappLink, type MessageTone } from "@/lib/billing-message";
import {
  avaliarRegua, diasEntre, ETAPA_POR_ID, soData,
  type EtapaDaRegua, type MotivoDeSupressao,
} from "@/lib/collection/regua";
import { escopoAtual, whereDaCobranca } from "@/lib/services/data-scope";

/**
 * A FILA DE COBRANÇA DO DIA (F3.9 · ref. 02 §4.3, §7.5).
 *
 * Transforma a régua em TAREFAS com mensagem pronta. Cada item traz tudo o
 * que se precisa para decidir em menos de vinte segundos (02 §4.2): quem,
 * quanto, há quanto tempo, qual o degrau da régua e o texto já escrito no tom
 * daquele degrau.
 *
 * AS SUPRIMIDAS VÊM JUNTO, com o motivo. Uma fila que só mostra o que dá para
 * fazer esconde a pergunta mais importante do módulo: "por que este cliente
 * não está sendo cobrado?". Cliente que some da fila em silêncio é dívida que
 * envelhece sem ninguém perceber.
 */

export type TarefaDeCobranca = {
  billingId: string;
  clientId: string;
  cliente: string;
  telefone: string | null;
  descricao: string;
  valorEmAberto: number;
  dueDate: Date;
  diasDeAtraso: number;
  etapa: EtapaDaRegua;
  etapaTitulo: string;
  objetivo: string;
  tom: MessageTone;
  mensagem: string;
  whatsapp: string | null;
  contatosAnteriores: number;
};

export type CobrancaSuprimida = {
  billingId: string;
  clientId: string;
  cliente: string;
  valorEmAberto: number;
  dueDate: Date;
  diasDeAtraso: number;
  motivo: MotivoDeSupressao;
  explicacao: string;
  /** Data em que o silêncio ou a promessa vence, quando é o caso. */
  ate: Date | null;
};

export type FilaDeCobranca = {
  hoje: Date;
  tarefas: TarefaDeCobranca[];
  suprimidas: CobrancaSuprimida[];
  totalEmAberto: number;
};

/** Janela de trabalho da régua: de D-3 até 60 dias de atraso. */
const ATRASO_MAXIMO = 60;

export async function filaDeCobranca(hoje: Date = new Date()): Promise<FilaDeCobranca> {
  const scope = await escopoAtual();
  const limiteFuturo = new Date(soData(hoje).getTime() + 4 * 86_400_000);
  const limitePassado = new Date(soData(hoje).getTime() - ATRASO_MAXIMO * 86_400_000);

  const cobrancas = await prisma.billing.findMany({
    where: {
      ...whereDaCobranca(scope),
      status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
      dueDate: { gte: limitePassado, lte: limiteFuturo },
    },
    select: {
      id: true, clientId: true, description: true, amount: true, paidTotal: true,
      dueDate: true, competenceMonth: true, competenceYear: true,
      client: {
        select: {
          id: true, name: true, phone: true,
          collectionOptOut: true, collectionSilenceUntil: true, collectionBlockReason: true,
        },
      },
      service: { select: { name: true } },
    },
    orderBy: { dueDate: "asc" },
  });
  if (cobrancas.length === 0)
    return { hoje, tarefas: [], suprimidas: [], totalEmAberto: 0 };

  const historicos = await prisma.collectionHistory.findMany({
    where: { billingId: { in: cobrancas.map((b) => b.id) } },
    orderBy: { contactedAt: "desc" },
    select: {
      billingId: true, reguaStep: true, status: true, nextActionAt: true, contactedAt: true,
    },
  });

  const porCobranca = new Map<string, typeof historicos>();
  for (const h of historicos) {
    const lista = porCobranca.get(h.billingId) ?? [];
    lista.push(h);
    porCobranca.set(h.billingId, lista);
  }

  const tarefas: TarefaDeCobranca[] = [];
  const suprimidas: CobrancaSuprimida[] = [];
  let totalEmAberto = 0;

  for (const b of cobrancas) {
    const aberto = Math.round((n(b.amount) - n(b.paidTotal)) * 100) / 100;
    if (aberto <= 0.005) continue;
    totalEmAberto += aberto;

    const historico = porCobranca.get(b.id) ?? [];
    const etapasEnviadas = historico
      .map((h) => h.reguaStep)
      .filter((s): s is EtapaDaRegua => !!s && ETAPA_POR_ID.has(s as EtapaDaRegua));
    // A promessa que vale é a MAIS RECENTE — cliente que prometeu, quebrou e
    // prometeu de novo tem uma data nova, e é ela que silencia a régua.
    const promessa = historico.find((h) => h.status === "PROMISED" && h.nextActionAt);

    const estado = {
      dueDate: b.dueDate,
      quitada: false,
      promessaAte: promessa?.nextActionAt ?? null,
      optOut: b.client.collectionOptOut,
      silencioAte: b.client.collectionSilenceUntil,
      bloqueio: b.client.collectionBlockReason,
      etapasEnviadas,
    };

    const r = avaliarRegua(hoje, estado);
    const atraso = Math.max(0, diasEntre(b.dueDate, hoje));

    if (!r.gerar) {
      // SEM_ETAPA_HOJE só acontece quando a régua já terminou (as cinco
      // etapas foram enviadas) ou ainda não começou. Não é informação para
      // ninguém — a fila mostra o que foi CALADO por decisão, não o que
      // simplesmente não tem tarefa hoje.
      if (r.motivo === "SEM_ETAPA_HOJE" || r.motivo === "FIM_DE_SEMANA") continue;
      suprimidas.push({
        billingId: b.id, clientId: b.clientId, cliente: b.client.name,
        valorEmAberto: aberto, dueDate: b.dueDate, diasDeAtraso: atraso,
        motivo: r.motivo, explicacao: r.explicacao,
        ate:
          r.motivo === "PROMESSA"
            ? (promessa?.nextActionAt ?? null)
            : r.motivo === "SILENCIO"
              ? b.client.collectionSilenceUntil
              : null,
      });
      continue;
    }

    const mensagem = buildBillingMessage(r.etapa.tom, {
      clientName: b.client.name,
      openAmount: formatBRL(aberto),
      dueDate: new Intl.DateTimeFormat("pt-BR").format(b.dueDate),
      daysOverdue: atraso,
      serviceNames: b.service?.name ? [b.service.name] : [],
      hasPromise: !!promessa,
      contactCount: historico.length,
      referenceMonth: `${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear}`,
    });

    tarefas.push({
      billingId: b.id, clientId: b.clientId, cliente: b.client.name,
      telefone: b.client.phone, descricao: b.description,
      valorEmAberto: aberto, dueDate: b.dueDate, diasDeAtraso: atraso,
      etapa: r.etapa.id, etapaTitulo: r.etapa.titulo, objetivo: r.etapa.objetivo,
      tom: r.etapa.tom, mensagem,
      whatsapp: whatsappLink(b.client.phone, mensagem),
      contatosAnteriores: historico.length,
    });
  }

  // Mais atrasado e mais caro primeiro: é a ordem em que o dinheiro some.
  tarefas.sort((a, b) => b.diasDeAtraso - a.diasDeAtraso || b.valorEmAberto - a.valorEmAberto);

  return {
    hoje,
    tarefas,
    suprimidas: suprimidas.sort((a, b) => b.valorEmAberto - a.valorEmAberto),
    totalEmAberto: Math.round(totalEmAberto * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Registrar o que aconteceu com a tarefa
// ---------------------------------------------------------------------------

/**
 * Marca a etapa como enviada. A unique (billingId, reguaStep) é a trava real:
 * o segundo clique recebe resposta limpa em vez de mandar a mesma mensagem de
 * novo para o cliente.
 */
export async function registrarEnvioDaRegua(
  billingId: string,
  etapa: EtapaDaRegua,
  opts: { canal?: string; mensagem?: string } = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ETAPA_POR_ID.has(etapa)) return { ok: false, error: "Etapa da régua desconhecida." };

  const b = await prisma.billing.findUnique({
    where: { id: billingId },
    select: { id: true, clientId: true, relationshipId: true, collectionStatus: true },
  });
  if (!b) return { ok: false, error: "Cobrança não encontrada." };

  const { contextFromRequest } = await import("@/lib/engines/context");
  const ctx = await contextFromRequest();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.collectionHistory.create({
        data: {
          billingId: b.id,
          clientId: b.clientId,
          relationshipId: b.relationshipId,
          status: "CONTACTED",
          channel: opts.canal ?? "whatsapp",
          message: opts.mensagem ?? null,
          reguaStep: etapa,
          createdBy: ctx.actorEmail,
        },
      });
      if (b.collectionStatus === "NOT_CONTACTED") {
        await tx.billing.update({ where: { id: b.id }, data: { collectionStatus: "CONTACTED" } });
      }
    });
  } catch (e: any) {
    if (e?.code === "P2002")
      return { ok: false, error: "Esta etapa já foi enviada para esta cobrança." };
    throw e;
  }
  return { ok: true };
}

/** O cliente deu uma data. A régua para até ela. */
export async function registrarPromessa(
  billingId: string,
  data: Date,
  observacao?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(data instanceof Date) || Number.isNaN(data.getTime()))
    return { ok: false, error: "Informe a data que o cliente prometeu." };

  const b = await prisma.billing.findUnique({
    where: { id: billingId },
    select: { id: true, clientId: true, relationshipId: true },
  });
  if (!b) return { ok: false, error: "Cobrança não encontrada." };

  const { contextFromRequest } = await import("@/lib/engines/context");
  const ctx = await contextFromRequest();

  await prisma.$transaction(async (tx) => {
    await tx.collectionHistory.create({
      data: {
        billingId: b.id, clientId: b.clientId, relationshipId: b.relationshipId,
        status: "PROMISED", channel: "whatsapp",
        message: observacao ?? null, nextActionAt: data,
        createdBy: ctx.actorEmail,
      },
    });
    await tx.billing.update({ where: { id: b.id }, data: { collectionStatus: "PROMISED" } });
  });
  return { ok: true };
}

export type PreferenciaDeCobranca = {
  optOut?: boolean;
  silencioAte?: Date | null;
  bloqueio?: string | null;
};

/**
 * Silenciar, bloquear ou liberar um cliente.
 *
 * BLOQUEIO EXIGE MOTIVO (e o banco confere): cliente que some da fila sem
 * explicação é cliente que ninguém cobra e ninguém percebe.
 */
export async function ajustarPreferenciaDeCobranca(
  clientId: string,
  p: PreferenciaDeCobranca
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (p.bloqueio !== undefined && p.bloqueio !== null && p.bloqueio.trim().length < 5)
    return { ok: false, error: "Escreva por que a cobrança deste cliente está bloqueada." };

  const antes = await prisma.client.findUnique({
    where: { id: clientId },
    select: { collectionOptOut: true, collectionSilenceUntil: true, collectionBlockReason: true },
  });
  if (!antes) return { ok: false, error: "Cliente não encontrado." };

  const depois = {
    collectionOptOut: p.optOut ?? antes.collectionOptOut,
    collectionSilenceUntil:
      p.silencioAte === undefined ? antes.collectionSilenceUntil : p.silencioAte,
    collectionBlockReason:
      p.bloqueio === undefined ? antes.collectionBlockReason : p.bloqueio?.trim() || null,
  };

  const { contextFromRequest } = await import("@/lib/engines/context");
  const { auditUpdate } = await import("@/lib/audit");
  const ctx = await contextFromRequest();

  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: depois });
    await auditUpdate(tx as any, "Client", clientId, antes, depois, ctx);
  });
  return { ok: true };
}
