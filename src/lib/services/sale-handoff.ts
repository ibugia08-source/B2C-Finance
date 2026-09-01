import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { abrirVidaDoCliente, agenciaPadrao } from "@/lib/services/client-lifecycle";
import { converterLead } from "@/lib/services/leads";
import { moverEtapa } from "@/lib/services/pipeline";
import { generateTcvInstallments } from "@/lib/engines/billing-engine";
import { addMonthsClamped } from "@/lib/financial/due-date";

/**
 * HANDOFF DA VENDA (F4.4 · ref. 01 §6.1).
 *
 *   Lead → Opportunity → WON → vincula/cria Client → Relationship
 *    → Contract rascunho → CommercialTerm → Onboarding → Billing(s)
 *
 * A frase que governa o arquivo é a última do §6.1: **"Sem contrato aprovado,
 * o lançamento direto continua possível."** O contrato FORMALIZA, não
 * bloqueia. Por isso ele nasce como RASCUNHO (`PENDING`) e nada espera por
 * ele: a cobrança é gerada, o onboarding começa e o cliente entra na
 * carteira. Um sistema que trava a operação até alguém assinar o PDF é um
 * sistema que a equipe contorna lançando por fora — e aí o dado real passa a
 * viver na planilha de novo.
 *
 * A SEGUNDA REGRA: **nada aqui derruba a venda**. Se o onboarding falhar ou
 * faltar agência, a venda continua ganha e o que faltou volta como PENDÊNCIA
 * escrita. Perder o registro de uma venda porque o board de implantação não
 * pôde ser criado seria trocar o fato mais importante pelo menos importante.
 *
 * IDEMPOTENTE: marcar GANHA duas vezes não cria dois clientes nem duas
 * cobranças. A oportunidade guarda o que gerou (`createdClientId`,
 * `createdContractId`) e o segundo clique devolve o mesmo resultado.
 */

export type ResultadoDoHandoff = {
  ok: true;
  clientId: string;
  relationshipId: string | null;
  contractId: string | null;
  billingIds: string[];
  /** O que não deu certo, em português. A venda está registrada mesmo assim. */
  pendencias: string[];
  jaTinhaSidoFeito: boolean;
};

export type FalhaDoHandoff = { ok: false; error: string };

export type OpcoesDoHandoff = {
  /** Cliente escolhido à mão quando a sugestão de duplicata é aceita. */
  clientIdEscolhido?: string | null;
  /** Primeiro vencimento; padrão: daqui a 5 dias. */
  primeiroVencimento?: Date;
  /** Em quantas vezes o TCV entra. Padrão: 1. */
  parcelas?: number;
  quando?: Date;
};

export async function fecharVenda(
  opportunityId: string,
  opts: OpcoesDoHandoff = {}
): Promise<ResultadoDoHandoff | FalhaDoHandoff> {
  const o = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: {
      id: true, title: true, stage: true, amount: true, modality: true,
      months: true, agencyId: true, closer: true, leadId: true, clientId: true,
      createdClientId: true, createdContractId: true,
      lead: { select: { id: true, name: true, company: true, status: true } },
    },
  });
  if (!o) return { ok: false, error: "Oportunidade não encontrada." };

  // Segundo clique: devolve o que já foi feito, sem repetir nada.
  if (o.createdClientId) {
    const cobrancas = await prisma.billing.findMany({
      where: { contractId: o.createdContractId ?? undefined },
      select: { id: true },
    });
    return {
      ok: true,
      clientId: o.createdClientId,
      relationshipId: null,
      contractId: o.createdContractId,
      billingIds: cobrancas.map((b) => b.id),
      pendencias: [],
      jaTinhaSidoFeito: true,
    };
  }

  const agora = opts.quando ?? new Date();
  const pendencias: string[] = [];
  const valor = n(o.amount);
  const ehMrr = o.modality === "MRR";

  // 1. O CLIENTE. Três caminhos, na ordem de confiança: cliente já ligado à
  //    oportunidade → conversão do lead (que deduplica por documento) →
  //    cliente escolhido à mão.
  let clientId: string;
  if (o.clientId) {
    clientId = o.clientId;
  } else if (o.leadId && o.lead && o.lead.status !== "CONVERTED") {
    const c = await converterLead(o.leadId, { clientIdEscolhido: opts.clientIdEscolhido });
    if (!c.ok) return { ok: false, error: c.error };
    clientId = c.clientId;
  } else if (opts.clientIdEscolhido) {
    clientId = opts.clientIdEscolhido;
  } else if (o.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: o.leadId },
      select: { convertedClientId: true },
    });
    if (!lead?.convertedClientId)
      return { ok: false, error: "Este lead já foi convertido, mas sem cliente ligado." };
    clientId = lead.convertedClientId;
  } else {
    return {
      ok: false,
      error: "A oportunidade não tem lead nem cliente — escolha para quem foi a venda.",
    };
  }

  // 2. O cliente vira ATIVO e ganha os números da venda. O que ele era antes
  //    (prospect, churnado) deixa de valer no momento em que a venda fecha.
  await prisma.client.update({
    where: { id: clientId },
    data: {
      status: "ACTIVE",
      churnedAt: null,
      modality: ehMrr ? "MRR" : "TCV",
      ...(ehMrr ? { monthlyValue: valor } : { totalContractValue: valor }),
      contractMonths: o.months ?? undefined,
      startedAt: agora,
      salesOwner: o.closer ?? undefined,
    },
  });

  // 3. RELAÇÃO + TERMO + ONBOARDING. Reaproveita o mesmo caminho do cadastro
  //    manual e da planilha — três portas, uma sequência só.
  const agencyId = o.agencyId ?? (await agenciaPadrao());
  const vida = await abrirVidaDoCliente(clientId, {
    status: "ACTIVE",
    startedAt: agora,
    modality: ehMrr ? "MRR" : "TCV",
    monthlyValue: ehMrr ? valor : null,
    totalContractValue: ehMrr ? null : valor,
    contractMonths: o.months ?? null,
    agencyId,
  });
  pendencias.push(...vida.faltou);

  // 4. CONTRATO RASCUNHO. Nasce PENDING de propósito: formaliza, não bloqueia.
  const meses = o.months ?? (ehMrr ? 12 : 1);
  const contrato = await prisma.contract.create({
    data: {
      clientId,
      title: o.title,
      type: ehMrr ? "MRR" : "TCV",
      status: "PENDING",
      monthlyValue: ehMrr ? valor : 0,
      totalValue: ehMrr ? valor * meses : valor,
      startDate: agora,
      endDate: addMonthsClamped(agora, meses),
      renewalDate: addMonthsClamped(agora, meses),
      notes: `Rascunho gerado no fechamento da venda. Formaliza a venda; não bloqueia a operação (01 §6.1).`,
    },
    select: { id: true },
  });

  // 5. COBRANÇAS. MRR não gera nada aqui: a mensalidade nasce do ciclo mensal
  //    a partir do termo (01 §3.2), e criar uma cobrança avulsa agora faria o
  //    primeiro mês ser faturado duas vezes.
  const billingIds: string[] = [];
  if (!ehMrr && valor > 0) {
    const vencimento = opts.primeiroVencimento ?? new Date(agora.getTime() + 5 * 86_400_000);
    const parcelas = Math.max(1, opts.parcelas ?? 1);
    const r = await generateTcvInstallments({
      clientId,
      contractId: contrato.id,
      description: o.title,
      total: valor,
      installments: parcelas,
      firstDueDate: vencimento,
      firstCompetence: { year: vencimento.getFullYear(), month: vencimento.getMonth() + 1 },
      reason: "Venda fechada no funil.",
    });
    if (r.ok) billingIds.push(...r.parcelas.map((p) => p.id));
    else pendencias.push(`as cobranças não foram geradas: ${r.error}`);
  }

  // 6. A OPORTUNIDADE fecha por último, guardando o que gerou. Se algo acima
  //    tivesse derrubado o processo, a venda não ficaria marcada como ganha
  //    sem ter acontecido.
  const m = await moverEtapa(o.id, "GANHA", { quando: agora });
  if (!m.ok) pendencias.push(`a etapa não foi atualizada: ${m.error}`);

  // 7. OUTBOX na MESMA transação do último fato (03 §4.2). O CRM é avisado
  //    depois, pelo worker, com recuo e dead-letter: se o AvanceCRM estiver
  //    fora do ar, a venda continua fechada aqui — que é o que importa.
  const { publish } = await import("@/lib/outbox");
  const { currentWorkspaceId } = await import("@/lib/services/workspace");
  const workspaceId = await currentWorkspaceId().catch(() => null);

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({
      where: { id: o.id },
      data: { createdClientId: clientId, createdContractId: contrato.id },
    });
    if (workspaceId) {
      await publish(tx as any, {
        workspaceId,
        eventType: "SALE_WON",
        channel: "crm",
        sourceType: "Opportunity",
        sourceId: o.id,
        // Conteúdo MÍNIMO (03 §4.2): o suficiente para o CRM reconhecer a
        // venda, e nada além. Valor de contrato não vai — o CRM não precisa.
        payload: {
          opportunityId: o.id,
          clientId,
          contractId: contrato.id,
          titulo: o.title,
          closer: o.closer,
          modalidade: o.modality,
        },
      });
    }
  });

  return {
    ok: true,
    clientId,
    relationshipId: vida.relationshipId,
    contractId: contrato.id,
    billingIds,
    pendencias,
    jaTinhaSidoFeito: false,
  };
}

/**
 * Vendas ganhas que NÃO viraram cliente — o alerta de 02 §5.1 ("venda sem
 * contrato") e o item 13 do checklist de fechamento.
 *
 * A pergunta existe porque o handoff pode ser interrompido: alguém marca
 * GANHA arrastando o card no quadro, sem passar pelo fluxo. A venda fica
 * registrada e a operação não sabe dela.
 */
export async function vendasSemHandoff() {
  return prisma.opportunity.findMany({
    where: { stage: "GANHA", createdClientId: null },
    orderBy: { wonAt: "desc" },
    select: {
      id: true, title: true, amount: true, wonAt: true, closer: true,
      client: { select: { id: true, name: true } },
      lead: { select: { name: true, company: true } },
    },
  });
}
