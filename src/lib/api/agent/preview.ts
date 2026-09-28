import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { DomainContext } from "@/lib/engines/domain";
import { montarRotinaDoDia } from "@/lib/services/daily-routine";
import { formatBRL, formatDateBR, MONTHS_PT } from "@/lib/format";
import { CLIENT_STATUS_LABEL } from "@/lib/status-meta";
import { MONEY_EPSILON } from "@/lib/billing-status";
import { todayKey } from "@/lib/competence";
import { classifyEffectiveDate } from "@/lib/clients/status-history";
import { ApiError } from "../auth";
import { ClientCreateBody, ClientPatchBody, StatusChangeBody, entradaDoCadastro } from "../v1/clients-write";
import { ClientInputSchema } from "@/lib/services/client-service";
import { PaymentBody } from "../v1/payments-write";
import { ExpenseCreateBody, ExpensePatchBody, ExpensePayBody } from "../v1/expenses-write";
import { UpsellCreateBody, UpsellPatchBody } from "../v1/upsells-write";
import type { OperacaoDoAgente } from "./catalog";

/**
 * PREVIEW DAS AÇÕES DO AGENTE — lê o ESTADO ATUAL e descreve, em texto de
 * WhatsApp, exatamente o que a confirmação vai executar. Tudo aqui é
 * determinístico (nada da IA): nomes, valores e datas vêm do banco.
 *
 * Cada operação devolve também o `estado` lido: na confirmação ele é lido de
 * novo e, se mudou (a cobrança foi paga na tela, a despesa foi editada), a
 * ação NÃO executa — o usuário confirmou outra coisa.
 *
 * As recusas óbvias (cobrança já quitada, despesa cancelada, oportunidade já
 * decidida) acontecem aqui, antes de pedir confirmação; a rota de escrita
 * confere tudo de novo na execução.
 */

export type Preview = {
  /** "Encontrei:" / "Vou cadastrar:". */
  titulo: string;
  linhas: string[];
  /** Estado lido (vira hash). null = nada a comparar (criação). */
  estado: unknown;
  /** Rótulo humano (cliente, descrição) e valor, para trilha e resposta. */
  rotulo: string;
  valor: number | null;
  /** Corpo que será enviado na execução (com os padrões já fixados). */
  payload: Record<string, unknown>;
};

/** Corpo aceito por operação — o MESMO schema da rota de escrita. */
export const CORPO_DA_OPERACAO: Record<OperacaoDoAgente, z.ZodTypeAny> = {
  "clients.create": ClientCreateBody,
  "clients.update": ClientPatchBody,
  "client_status.change": StatusChangeBody,
  "payments.register": PaymentBody,
  "expenses.create": ExpenseCreateBody,
  "expenses.update": ExpensePatchBody,
  "expenses.pay": ExpensePayBody,
  "upsells.create": UpsellCreateBody,
  "upsells.update": UpsellPatchBody,
  "routine.complete": z.object({}).strict(),
};

// Espaço comum no lugar do espaço rígido do Intl: o texto vai para o WhatsApp e é comparado.
const reais = (v: unknown) => formatBRL(Number(v ?? 0)).replace(/\u00a0/g, " ");
const dia = (iso: string) => formatDateBR(`${iso}T00:00:00Z`);
const competencia = (ano: number, mes: number) => `${MONTHS_PT[mes - 1]}/${ano}`;
const hojeOuDia = (iso: string) => (iso === todayKey() ? `hoje (${dia(iso)})` : dia(iso));
const semNada = (v: unknown) => v === null || v === undefined || v === "";
const texto = (v: unknown) => (semNada(v) ? "(vazio)" : String(v));

const naoEncontrado = (rotulo: string) => new ApiError(404, "not_found", `${rotulo} não encontrado.`);
const estadoInvalido = (msg: string) => new ApiError(422, "invalid_state", msg);

const MODALIDADE: Record<string, string> = { MRR: "Recorrente (MRR)", TCV: "Projeto (TCV)" };
const TIPO_DESPESA: Record<string, string> = {
  FIXED: "Fixa", VARIABLE: "Variável", TAX: "Imposto", PAYROLL: "Folha", TOOL: "Ferramenta",
  ADS: "Anúncios", LOAN: "Empréstimo", OTHER: "Outra",
};
const RECORRENCIA: Record<string, string> = {
  NONE: "Única", MONTHLY: "Mensal", QUARTERLY: "Trimestral", SEMIANNUAL: "Semestral", ANNUAL: "Anual", CUSTOM: "Personalizada",
};
const FUNIL: Record<string, string> = { OPPORTUNITY: "Oportunidade", NEGOTIATION: "Negociação", PAUSED: "Pausada" };
const FORMA: Record<string, string> = { PIX: "Pix", BOLETO: "Boleto", CARD: "Cartão", TRANSFER: "Transferência", CASH: "Dinheiro" };

async function nomeDoColaborador(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const e = await prisma.employee.findFirst({ where: { id }, select: { name: true } });
  if (!e) throw new ApiError(404, "not_found", "Responsável (colaborador) não encontrado.");
  return e.name;
}

async function nomeDaCategoria(b: { categoryId?: string | null; category?: string }): Promise<string | null> {
  if (b.category) {
    const c = await prisma.category.findFirst({ where: { name: { equals: b.category, mode: "insensitive" } }, select: { name: true } });
    if (!c) throw new ApiError(404, "not_found", `Categoria “${b.category}” não encontrada.`);
    return c.name;
  }
  if (b.categoryId) {
    const c = await prisma.category.findFirst({ where: { id: b.categoryId }, select: { name: true } });
    if (!c) throw new ApiError(404, "not_found", "Categoria não encontrada.");
    return c.name;
  }
  return null;
}

async function nomeDoServico(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const s = await prisma.service.findFirst({ where: { id }, select: { name: true } });
  if (!s) throw new ApiError(404, "not_found", "Serviço não encontrado.");
  return s.name;
}

/** "Campo: antes → depois" para cada campo enviado numa edição. */
function mudancas(rotulos: Record<string, string>, antes: Record<string, unknown>, depois: Record<string, unknown>): string[] {
  return Object.keys(depois).map((k) => `${rotulos[k] ?? k}: ${texto(antes[k])} → ${texto(depois[k])}`);
}

const ROTULO_CLIENTE: Record<string, string> = {
  name: "Nome", legalName: "Razão social", document: "Documento", email: "E-mail", phone: "Telefone",
  nicheId: "Nicho", city: "Cidade", state: "UF", address: "Endereço", legalRepresentative: "Representante legal",
  origin: "Origem", responsibleId: "Responsável", operationsOwner: "Responsável operacional", paymentDay: "Dia de pagamento",
  tags: "Etiquetas", modality: "Modalidade", monthlyValue: "Valor mensal", totalContractValue: "Valor do contrato",
  contractMonths: "Prazo (meses)", contractIndefinite: "Prazo indeterminado", startedAt: "Início", notes: "Observações",
};

// ---------------------------------------------------------------------------

type Montador = (ctx: DomainContext, targetId: string | null, b: any) => Promise<Preview>;

const PREVIEWS: Record<OperacaoDoAgente, Montador> = {
  async "clients.create"(_ctx, _t, b: z.output<typeof ClientCreateBody>) {
    // A MESMA regra do cadastro (ex.: MRR precisa de prazo): recusa aqui, antes
    // do "Confirmar", para o agente perguntar o que falta.
    const regra = ClientInputSchema.safeParse(entradaDoCadastro(b));
    if (!regra.success) {
      throw new ApiError(
        400,
        "validation_error",
        `Falta dado para cadastrar: ${regra.error.issues[0]?.message ?? "confira os campos"}`,
        undefined,
        regra.error.issues.map((i) => ({ field: ["input", ...i.path].join("."), message: i.message }))
      );
    }
    const responsavel = await nomeDoColaborador(b.responsibleId);
    const parecidos = await prisma.client.findMany({
      where: { name: { contains: b.name, mode: "insensitive" } },
      select: { name: true },
      take: 3,
    });
    const linhas = [`*${b.name}*`];
    if (b.legalName) linhas.push(`Razão social: ${b.legalName}`);
    if (b.document) linhas.push(`Documento: ${b.document}`);
    if (b.modality) linhas.push(`Modalidade: ${MODALIDADE[b.modality]}`);
    if (b.monthlyValue != null) linhas.push(`Valor mensal: ${reais(b.monthlyValue)}`);
    if (b.totalContractValue != null) linhas.push(`Valor do contrato: ${reais(b.totalContractValue)}`);
    if (b.contractIndefinite) linhas.push("Prazo: indeterminado");
    else if (b.contractMonths) linhas.push(`Prazo: ${b.contractMonths} meses`);
    if (b.paymentDay) linhas.push(`Dia de pagamento: ${b.paymentDay}`);
    if (b.startedAt) linhas.push(`Início: ${dia(b.startedAt)}`);
    if (responsavel) linhas.push(`Responsável: ${responsavel}`);
    linhas.push(`Status inicial: ${CLIENT_STATUS_LABEL[b.initialStatus]} (a partir de hoje)`);
    if (parecidos.length) {
      linhas.push(`Atenção: já existe cliente com nome parecido — ${parecidos.map((p) => p.name).join(", ")}.`);
    }
    return {
      titulo: "Vou cadastrar:", linhas, estado: null, rotulo: b.name,
      valor: b.monthlyValue ?? b.totalContractValue ?? null, payload: b,
    };
  },

  async "clients.update"(_ctx, id, b: z.output<typeof ClientPatchBody>) {
    const c = await prisma.client.findFirst({ where: { id: id! }, select: { id: true, name: true, updatedAt: true, salesOwner: true } });
    if (!c) throw naoEncontrado("Cliente");
    const atual = (await prisma.client.findFirst({ where: { id: id! } })) as Record<string, unknown>;
    const antes: Record<string, unknown> = {
      ...atual,
      responsibleId: c.salesOwner,
      operationsOwner: atual.opsOwner,
      monthlyValue: atual.monthlyValue == null ? null : reais(atual.monthlyValue),
      totalContractValue: atual.totalContractValue == null ? null : reais(atual.totalContractValue),
      startedAt: atual.startedAt ? formatDateBR(atual.startedAt as Date) : null,
      tags: Array.isArray(atual.tags) ? (atual.tags as string[]).join(", ") : null,
    };
    const depois: Record<string, unknown> = { ...b };
    if (b.responsibleId !== undefined) depois.responsibleId = await nomeDoColaborador(b.responsibleId);
    if (b.monthlyValue != null) depois.monthlyValue = reais(b.monthlyValue);
    if (b.totalContractValue != null) depois.totalContractValue = reais(b.totalContractValue);
    if (b.startedAt) depois.startedAt = dia(b.startedAt);
    if (b.tags) depois.tags = b.tags.join(", ");
    return {
      titulo: "Encontrei:",
      linhas: [`*${c.name}*`, ...mudancas(ROTULO_CLIENTE, antes, depois)],
      estado: { updatedAt: c.updatedAt.toISOString() },
      rotulo: c.name, valor: null, payload: b,
    };
  },

  async "client_status.change"(_ctx, id, b: z.output<typeof StatusChangeBody>) {
    const c = await prisma.client.findFirst({ where: { id: id! }, select: { name: true, status: true } });
    if (!c) throw naoEncontrado("Cliente");
    const historico = await prisma.clientStatusHistory.findMany({
      where: { clientId: id! },
      orderBy: { effectiveFrom: "asc" },
      select: { id: true, status: true, effectiveFrom: true, effectiveTo: true, updatedAt: true },
    });
    const retroativa = classifyEffectiveDate(b.effectiveFrom, todayKey()) === "RETROATIVA";
    const linhas = [
      `*${c.name}*`,
      `Status de hoje: ${CLIENT_STATUS_LABEL[c.status] ?? c.status}`,
      `Novo status: ${CLIENT_STATUS_LABEL[b.status] ?? b.status}`,
      `A partir de: ${hojeOuDia(b.effectiveFrom)}`,
    ];
    if (b.reason) linhas.push(`Motivo: ${b.reason}`);
    if (retroativa) {
      linhas.push(
        b.allowRetroactive
          ? "Atenção: data num mês que já passou — reescreve a carteira daquele mês."
          : "Atenção: data num mês que já passou — a API vai recusar sem a confirmação de retroativo."
      );
    }
    return {
      titulo: "Encontrei:", linhas,
      estado: { status: c.status, historico: historico.map((h) => [h.id, h.status, h.effectiveFrom, h.effectiveTo, h.updatedAt]) },
      rotulo: c.name, valor: null, payload: b,
    };
  },

  async "payments.register"(_ctx, id, b: z.output<typeof PaymentBody>) {
    const cob = await prisma.billing.findFirst({
      where: { id: id! },
      select: {
        status: true, amount: true, paidTotal: true, competenceMonth: true, competenceYear: true, dueDate: true,
        client: { select: { name: true } },
      },
    });
    if (!cob) throw naoEncontrado("Recebimento");
    if (cob.status === "CANCELED") throw estadoInvalido("Cobrança removida do mês não recebe pagamento.");
    if (cob.status === "RENEGOTIATED") throw estadoInvalido("Cobrança renegociada: o pagamento vai nas parcelas do acordo.");
    const saldo = Math.round((Number(cob.amount) - Number(cob.paidTotal)) * 100) / 100;
    if (cob.status === "PAID" || saldo <= MONEY_EPSILON) throw estadoInvalido("Esta cobrança já está quitada.");
    const paidAt = b.paidAt ?? todayKey();
    if (paidAt > todayKey()) throw new ApiError(422, "unprocessable", "A data do pagamento não pode ser futura.");
    const linhas = [
      `*${cob.client.name}*`,
      `Recebimento em aberto: ${reais(saldo)}`,
      `Competência: ${competencia(cob.competenceYear, cob.competenceMonth)}`,
      `Vencimento: ${formatDateBR(cob.dueDate)}`,
      `Valor do pagamento: ${reais(b.amount)}${b.amount < saldo - MONEY_EPSILON ? " (parcial)" : ""}`,
      `Data de pagamento: ${hojeOuDia(paidAt)}`,
      `Forma: ${FORMA[b.method] ?? b.method}`,
    ];
    if (b.amount > saldo + MONEY_EPSILON) {
      linhas.push(
        b.allowOverpayment
          ? `Atenção: passa do saldo — ${reais(b.amount - saldo)} viram crédito do cliente.`
          : "Atenção: o valor passa do saldo em aberto — a API vai recusar."
      );
    }
    return {
      titulo: "Encontrei:", linhas,
      estado: { status: cob.status, amount: Number(cob.amount), paidTotal: Number(cob.paidTotal) },
      rotulo: cob.client.name, valor: b.amount,
      // A data do preview é a da execução (não "hoje" de quando confirmar).
      payload: { ...b, paidAt },
    };
  },

  async "expenses.create"(_ctx, _t, b: z.output<typeof ExpenseCreateBody>) {
    const categoria = await nomeDaCategoria(b);
    const linhas = [
      `*${b.description}*`,
      `Valor: ${reais(b.amount)}`,
      `Vencimento: ${dia(b.dueDate)}`,
      `Tipo: ${TIPO_DESPESA[b.type] ?? b.type}`,
      `Recorrência: ${RECORRENCIA[b.recurrence] ?? b.recurrence}${b.recurrence === "CUSTOM" ? ` (a cada ${b.recurrenceInterval ?? 1} mês/meses)` : ""}`,
    ];
    if (categoria) linhas.push(`Categoria: ${categoria}`);
    linhas.push("Situação: a pagar (pagar é outro pedido)");
    return { titulo: "Vou lançar:", linhas, estado: null, rotulo: b.description, valor: b.amount, payload: b };
  },

  async "expenses.update"(_ctx, id, b: z.output<typeof ExpensePatchBody>) {
    const d = await prisma.transaction.findFirst({
      where: { id: id!, type: "despesa" },
      select: {
        description: true, amount: true, dueDate: true, date: true, status: true, expenseType: true, notes: true,
        categoryId: true, category: { select: { name: true } },
      },
    });
    if (!d) throw naoEncontrado("Despesa");
    if (d.status !== "pendente") throw estadoInvalido(`Despesa com status “${d.status}” não é editada pelo agente.`);
    if (d.expenseType === "CARD") throw estadoInvalido("Despesa de cartão não é editada pelo agente.");
    const antes: Record<string, unknown> = {
      description: d.description, amount: reais(d.amount), dueDate: formatDateBR(d.dueDate ?? d.date),
      type: TIPO_DESPESA[d.expenseType ?? "OTHER"], notes: d.notes, category: d.category?.name ?? null, categoryId: d.category?.name ?? null,
    };
    const depois: Record<string, unknown> = { ...b };
    if (b.amount != null) depois.amount = reais(b.amount);
    if (b.dueDate) depois.dueDate = dia(b.dueDate);
    if (b.type) depois.type = TIPO_DESPESA[b.type];
    if (b.category !== undefined || b.categoryId !== undefined) {
      const nome = await nomeDaCategoria(b);
      if (b.category !== undefined) depois.category = nome;
      else depois.categoryId = nome;
    }
    const rotulos = { description: "Descrição", amount: "Valor", dueDate: "Vencimento", type: "Tipo", notes: "Observações", category: "Categoria", categoryId: "Categoria" };
    return {
      titulo: "Encontrei:",
      linhas: [`*${d.description}* — ${reais(d.amount)}`, ...mudancas(rotulos, antes, depois)],
      // Despesa não tem updatedAt: o estado é o conteúdo editável.
      estado: {
        status: d.status, description: d.description, amount: Number(d.amount), dueDate: d.dueDate, date: d.date,
        expenseType: d.expenseType, notes: d.notes, categoryId: d.categoryId,
      },
      rotulo: d.description, valor: b.amount ?? Number(d.amount), payload: b,
    };
  },

  async "expenses.pay"(_ctx, id) {
    const d = await prisma.transaction.findFirst({
      where: { id: id!, type: "despesa" },
      select: { description: true, amount: true, dueDate: true, date: true, status: true },
    });
    if (!d) throw naoEncontrado("Despesa");
    if (d.status === "cancelado") throw estadoInvalido("Despesa cancelada não é paga.");
    if (d.status === "pago") throw estadoInvalido("Esta despesa já está paga.");
    return {
      titulo: "Encontrei:",
      linhas: [
        `*${d.description}*`,
        `Valor: ${reais(d.amount)}`,
        `Vencimento: ${formatDateBR(d.dueDate ?? d.date)}`,
        `Pagamento: ${hojeOuDia(todayKey())}`,
      ],
      estado: { status: d.status, amount: Number(d.amount), dueDate: d.dueDate },
      rotulo: d.description, valor: Number(d.amount), payload: {},
    };
  },

  async "upsells.create"(_ctx, _t, b: z.output<typeof UpsellCreateBody>) {
    const cliente = await prisma.client.findFirst({ where: { id: b.clientId }, select: { name: true } });
    if (!cliente) throw naoEncontrado("Cliente");
    const servico = await nomeDoServico(b.serviceId);
    const responsavel = await nomeDoColaborador(b.responsibleId);
    const linhas = [`*${cliente.name}*`];
    if (servico) linhas.push(`Serviço: ${servico}`);
    if (b.description) linhas.push(`Oportunidade: ${b.description}`);
    linhas.push(`Valor: ${reais(b.amount)}`);
    linhas.push(`Etapa: ${FUNIL[b.status ?? "OPPORTUNITY"]}`);
    linhas.push(`Responsável: ${responsavel ?? "o do cliente"}`);
    if (b.expectedCloseDate) linhas.push(`Previsão de fechamento: ${dia(b.expectedCloseDate)}`);
    return { titulo: "Vou cadastrar a oportunidade:", linhas, estado: null, rotulo: cliente.name, valor: b.amount, payload: b };
  },

  async "upsells.update"(_ctx, id, b: z.output<typeof UpsellPatchBody>) {
    const u = await prisma.upsell.findFirst({
      where: { id: id! },
      select: {
        title: true, value: true, status: true, responsible: true, expectedCloseAt: true, notes: true, serviceId: true, updatedAt: true,
        client: { select: { name: true } }, service: { select: { name: true } },
      },
    });
    if (!u) throw naoEncontrado("Oportunidade");
    if (u.status === "WON" || u.status === "LOST") throw estadoInvalido("Oportunidade já decidida (vendida ou recusada) não é editada pelo agente.");
    const antes: Record<string, unknown> = {
      description: u.title, amount: reais(u.value), status: FUNIL[u.status] ?? u.status, responsibleId: u.responsible,
      expectedCloseDate: u.expectedCloseAt ? formatDateBR(u.expectedCloseAt) : null, notes: u.notes, serviceId: u.service?.name ?? null,
    };
    const depois: Record<string, unknown> = { ...b };
    if (b.amount != null) depois.amount = reais(b.amount);
    if (b.status) depois.status = FUNIL[b.status];
    if (b.responsibleId !== undefined) depois.responsibleId = await nomeDoColaborador(b.responsibleId);
    if (b.expectedCloseDate) depois.expectedCloseDate = dia(b.expectedCloseDate);
    if (b.serviceId !== undefined) depois.serviceId = await nomeDoServico(b.serviceId);
    const rotulos = {
      description: "Oportunidade", amount: "Valor", status: "Etapa", responsibleId: "Responsável",
      expectedCloseDate: "Previsão de fechamento", notes: "Observações", serviceId: "Serviço",
    };
    return {
      titulo: "Encontrei:",
      linhas: [`*${u.client.name}* — ${u.title ?? u.service?.name ?? "oportunidade"}`, ...mudancas(rotulos, antes, depois)],
      estado: { updatedAt: u.updatedAt.toISOString(), status: u.status },
      rotulo: u.client.name, valor: b.amount ?? Number(u.value), payload: b,
    };
  },

  async "routine.complete"(ctx, chave) {
    const rotina = await montarRotinaDoDia(ctx);
    const acao = rotina.acoes.find((a) => a.key === chave);
    if (!acao) throw new ApiError(404, "not_found", "Ação não encontrada na rotina de hoje.");
    const feita = rotina.doneActions.has(acao.key);
    if (feita) throw estadoInvalido("Esta ação da rotina já está concluída.");
    return {
      titulo: "Encontrei na rotina de hoje:",
      linhas: [`*${acao.text}*`, `Prioridade: ${acao.priority}`],
      estado: { key: acao.key, feita, dia: todayKey() },
      rotulo: acao.text, valor: null, payload: {},
    };
  },
};

export function montarPreview(ctx: DomainContext, op: OperacaoDoAgente, targetId: string | null, corpo: unknown): Promise<Preview> {
  return PREVIEWS[op](ctx, targetId, corpo);
}
