import { z } from "zod";
import { ClientStatus, ClientModality } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import { abrirVidaDoCliente } from "@/lib/services/client-lifecycle";
import { expectativaAoSalvar } from "@/lib/services/client-status-transition";
import { expectationFromBase, parseCompetenceKey } from "@/lib/renewal-expectation";
import { recordLosses } from "@/lib/services/client-status-transition";
import {
  type DomainContext, type DomainResult, domainActor, inDomain, statusCapabilities,
} from "@/lib/engines/domain";

/**
 * CADASTRO DE CLIENTE — regra de domínio (extraída de actions/clients.ts em
 * 27/09/2026, SEM mudança de comportamento). A Server Action converte o
 * formulário em `ClientInput` e chama `salvarCliente`; a futura API chamará
 * a mesma função. Validação por modalidade, deduplicação, normalização
 * MRR/TCV, responsável e nicho, expectativa de renovação, status pela linha
 * do tempo (vigência a partir de hoje), relação/onboarding e contrato +
 * cobranças do cadastro vivem aqui — uma vez só.
 *
 * Não invalida cache: quem chama chama `revalidateAgency`.
 */

/**
 * DEDUPLICAÇÃO DO CADASTRO (F1.16 · ref. 02 §4.1: "Cadastro deduplica no Client").
 *
 * Duas travas com severidades diferentes, de propósito:
 *  · DOCUMENTO igual é bloqueio duro. Dois CNPJs iguais são a mesma
 *    empresa — não existe caso legítimo, e deixar passar cria a carteira
 *    duplicada que a migração depois tem de desfazer à mão.
 *  · NOME igual é bloqueio COM SAÍDA. "Padaria Central" pode mesmo ser
 *    duas empresas diferentes, então avisamos, mostramos qual já existe e
 *    deixamos confirmar. Bloquear de vez seria decidir pelo usuário algo
 *    que só ele sabe.
 *
 * A comparação de nome ignora acento, caixa e espaço repetido — "Ótica
 * São Paulo" e "otica sao  paulo" são a mesma coisa para uma pessoa, e
 * precisam ser para o sistema também.
 */
const soDigitos = (v: string) => v.replace(/\D+/g, "");

const chaveNome = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

async function acharDuplicado(
  nome: string,
  documento: string | null,
  permitirNomeRepetido: boolean,
  /** Na EDIÇÃO: o próprio cliente não conta como duplicado. */
  exceto?: string
): Promise<DomainResult | null> {
  const doc = documento ? soDigitos(documento) : "";
  if (doc.length >= 11) {
    const comDoc = await prisma.client.findMany({
      where: { document: { not: null }, ...(exceto ? { id: { not: exceto } } : {}) },
      select: { id: true, name: true, document: true },
    });
    const igual = comDoc.find((c) => soDigitos(c.document ?? "") === doc);
    if (igual) {
      return {
        ok: false,
        error: `Esse CNPJ/CPF já está cadastrado em "${igual.name}". Abra o cliente existente em vez de criar outro.`,
      };
    }
  }

  if (!permitirNomeRepetido) {
    const alvo = chaveNome(nome);
    const todos = await prisma.client.findMany({ select: { id: true, name: true } });
    const igual = todos.find((c) => chaveNome(c.name) === alvo);
    if (igual) {
      return {
        ok: false,
        code: "DUPLICADO_NOME",
        error: `Já existe um cliente chamado "${igual.name}". Se for o mesmo, abra o que já existe; se forem empresas diferentes, confirme abaixo.`,
      };
    }
  }
  return null;
}

export const ClientInputSchema = z
  .object({
    id: z.string().optional(),
    /** Cadastro NOVO com nome igual a outro já existente, confirmado pelo usuário. */
    permitirDuplicado: z.boolean().default(false),
    name: z.string().trim().min(1, "Informe o nome do cliente."),
    legalName: z.string().trim().nullable(),
    document: z.string().trim().nullable(),
    email: z
      .union([z.string().trim().email("E-mail inválido."), z.literal(""), z.null()])
      .transform((v) => (v ? v : null)),
    phone: z.string().trim().nullable(),
    // Nicho: vínculo com o catálogo (Niche); o texto `segment` é derivado do
    // nome do nicho (denormalização para filtros/relatórios/documentos).
    nicheId: z.string().trim().nullable(),
    city: z.string().trim().nullable(),
    state: z.string().trim().max(2, "Use a sigla da UF (ex.: BA).").nullable(),
    address: z.string().trim().nullable(),
    legalRepresentative: z.string().trim().nullable(),
    origin: z.string().trim().nullable(),
    // Responsável comercial: vínculo com Employee; o texto salesOwner é
    // derivado do nome do colaborador (denormalização para filtros/relatórios).
    salesOwnerId: z.string().trim().nullable(),
    opsOwner: z.string().trim().nullable(),
    // Dia recorrente de pagamento MRR (1-31; ajustado ao último dia do mês).
    paymentDay: z
      .number()
      .int()
      .min(1, "Dia entre 1 e 31.")
      .max(31, "Dia entre 1 e 31.")
      .nullable(),
    tags: z.array(z.string().trim().min(1)).default([]),
    status: z.nativeEnum(ClientStatus),
    // Modalidade de faturamento — define quais campos são obrigatórios.
    modality: z.nativeEnum(ClientModality).nullable(),
    // MRR: valor mensal recorrente. TCV: valor total do contrato.
    monthlyValue: z.number().nonnegative("Valor não pode ser negativo.").nullable(),
    totalContractValue: z.number().nonnegative("Valor não pode ser negativo.").nullable(),
    contractMonths: z.number().int().positive("Prazo deve ser maior que zero.").nullable(),
    // Prazo INDETERMINADO: sem término; contractMonths fica nulo.
    contractIndefinite: z.boolean().default(false),
    startedAt: z.date().nullable(),
    notes: z.string().trim().nullable(),
  })
  // ===== Regras condicionais por modalidade (Bloco 1 §7) =====
  .superRefine((v, ctx) => {
    if (v.modality === "MRR") {
      if (!(v.monthlyValue && v.monthlyValue > 0))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["monthlyValue"],
          message: "MRR exige o valor mensal recorrente (maior que zero).",
        });
      if (v.paymentDay == null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentDay"],
          message: "MRR exige o dia recorrente de pagamento (1 a 31).",
        });
    }
    if (v.modality === "TCV") {
      if (!(v.totalContractValue && v.totalContractValue > 0))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totalContractValue"],
          message: "TCV exige o valor total do contrato (maior que zero).",
        });
      if (v.contractIndefinite)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contractMonths"],
          message: "TCV é um valor fechado por um prazo: informe o prazo em meses (Indeterminado vale só para MRR).",
        });
      else if (v.contractMonths == null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contractMonths"],
          message: "TCV exige o prazo do contrato em meses.",
        });
      if (v.startedAt == null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startedAt"],
          message: "TCV exige a data de entrada/fechamento.",
        });
    }
  });


export type ClientInput = z.input<typeof ClientInputSchema>;

/** Cria (sem `id`) ou atualiza (com `id`) um cliente. */
export async function salvarCliente(
  ctx: DomainContext,
  input: ClientInput
): Promise<DomainResult> {
  return inDomain(ctx, async () => {
    const parsed = ClientInputSchema.parse(input);

    // ===== Normalização por modalidade (limpa o que não pertence) =====
    // MRR usa monthlyValue + paymentDay (dia recorrente). TCV usa
    // totalContractValue e NÃO tem dia recorrente nem mensal. Sem modalidade
    // (leads/legado): mantém o que veio.
    const modality = parsed.modality;
    const modalityFields =
      modality === "MRR"
        ? {
            modality,
            monthlyValue: parsed.monthlyValue,
            totalContractValue: null,
            paymentDay: parsed.paymentDay,
            contractMonths: parsed.contractMonths,
            contractIndefinite: parsed.contractIndefinite,
          }
        : modality === "TCV"
          ? {
              modality,
              monthlyValue: null, // TCV não tem mensalidade recorrente
              totalContractValue: parsed.totalContractValue,
              paymentDay: null, // TCV não tem dia recorrente de pagamento
              contractMonths: parsed.contractMonths,
              contractIndefinite: false,
            }
          : {
              modality: null,
              monthlyValue: parsed.monthlyValue,
              totalContractValue: parsed.totalContractValue,
              paymentDay: parsed.paymentDay,
              contractMonths: parsed.contractMonths,
              contractIndefinite: parsed.contractIndefinite,
            };

    // Resolve o colaborador responsável. findUnique é pós-filtrado por dono →
    // id de outro owner volta null. O texto salesOwner é sincronizado com o
    // nome do colaborador para manter filtros/relatórios/importação intactos.
    let salesOwnerEmployee: { id: string; name: string } | null = null;
    // "__texto__" = manter o responsável que só existe como texto no cadastro
    // (importação). Se houver colaborador com o mesmo nome, liga os dois.
    let manterTexto: string | null = null;
    if (parsed.salesOwnerId === "__texto__") {
      const atual = parsed.id
        ? await prisma.client.findFirst({ where: { id: parsed.id }, select: { salesOwner: true } })
        : null;
      manterTexto = atual?.salesOwner ?? null;
      if (manterTexto) {
        const emp = await prisma.employee.findFirst({
          where: { name: { equals: manterTexto, mode: "insensitive" } },
          select: { id: true, name: true },
        });
        if (emp) {
          salesOwnerEmployee = emp;
          manterTexto = null;
        }
      }
    } else if (parsed.salesOwnerId) {
      const emp = await prisma.employee.findUnique({
        where: { id: parsed.salesOwnerId },
      });
      if (!emp) return { ok: false, error: "Colaborador responsável não encontrado." };
      salesOwnerEmployee = { id: emp.id, name: emp.name };
    }

    // Nicho escolhido da lista: precisa existir no catálogo deste dono.
    let niche: { id: string; name: string } | null = null;
    if (parsed.nicheId) {
      niche = await prisma.niche.findFirst({
        where: { id: parsed.nicheId },
        select: { id: true, name: true },
      });
      if (!niche) return { ok: false, error: "Nicho não encontrado no catálogo." };
    }

    const base = {
      name: parsed.name,
      legalName: parsed.legalName,
      document: parsed.document,
      email: parsed.email,
      phone: parsed.phone,
      nicheId: niche?.id ?? null,
      segment: niche?.name ?? null,
      city: parsed.city,
      state: parsed.state,
      address: parsed.address,
      legalRepresentative: parsed.legalRepresentative,
      origin: parsed.origin,
      salesOwnerId: salesOwnerEmployee?.id ?? null,
      salesOwner: salesOwnerEmployee?.name ?? manterTexto,
      opsOwner: parsed.opsOwner,
      tags: parsed.tags,
      status: parsed.status,
      startedAt: parsed.startedAt,
      notes: parsed.notes,
      ...modalityFields,
    };

    let id = parsed.id;
    if (id) {
      // findUnique é pós-filtrado por dono → cliente de outro owner volta null.
      const existing = await prisma.client.findUnique({ where: { id } });
      if (!existing) return { ok: false, error: "Cliente não encontrado." };
      // CNPJ/CPF de OUTRO cliente colado na edição também é duplicata
      // (antes a checagem só rodava na criação). Nome repetido na edição
      // não bloqueia: renomear para um nome parecido é legítimo.
      if (parsed.document && soDigitos(parsed.document) !== soDigitos(existing.document ?? "")) {
        const dup = await acharDuplicado(parsed.name, parsed.document, true, id);
        if (dup) return dup;
      }
      const expectativa = expectativaAoSalvar(
        { ...existing, status: existing.status },
        {
          startedAt: parsed.startedAt,
          contractMonths: modalityFields.contractMonths ?? null,
          contractIndefinite: modalityFields.contractIndefinite,
          status: existing.status, // a troca de status vem depois, pelo caminho único
        }
      );
      // Grava o cadastro SEM trocar o status; a troca (se houver) passa por
      // linha do tempo de status — perda, relação, termo e cobranças acompanham.
      const atualizado = await prisma.client.update({
        where: { id },
        data: {
          ...base,
          status: existing.status,
          churnedAt: existing.churnedAt,
          ...(expectativa !== undefined ? { expectedRenewalAt: expectativa } : {}),
        },
      });
      if (modalityFields.contractIndefinite && !existing.contractIndefinite) {
        const { liberarTerminoDosContratos } = await import("@/lib/services/lifecycle");
        await liberarTerminoDosContratos(id);
      }
      // Status no cadastro = "a partir de hoje" pela linha do tempo; os meses
      // anteriores ficam como estavam. Vigência em outra data: diálogo
      // "Alterar status".
      if (parsed.status !== existing.status) {
        const { changeClientStatus } = await import("@/lib/clients/status-history");
        const { todayKey } = await import("@/lib/competence");
        await changeClientStatus(
          { clientId: atualizado.id, status: parsed.status, effectiveFrom: todayKey(), actor: domainActor(ctx) },
          statusCapabilities(ctx)
        );
      }
    } else {
      // Deduplicação antes de criar (02 §4.1).
      const duplicado = await acharDuplicado(
        parsed.name,
        parsed.document,
        parsed.permitirDuplicado
      );
      if (duplicado) return duplicado;

      const created = await prisma.client.create({
        data: {
          ...base,
          churnedAt: parsed.status === "CHURNED" ? new Date() : null,
          // Entrada + prazo = expectativa de renovação (regra do dono).
          expectedRenewalAt: modalityFields.contractIndefinite
            ? null
            : expectationFromBase(parsed.startedAt, modalityFields.contractMonths ?? null),
        },
      });
      id = created.id;

      // F1.1 + F1.18 — todo cliente novo nasce com RELAÇÃO e com o
      // onboarding aberto. "Cliente manual também inicia" (F1.18): o
      // roteiro de implantação não é privilégio de quem entrou pelo
      // funil comercial, senão metade da carteira fica sem implantação
      // registrada e o board vira ficção.
      //
      // Sem a relação, a cobrança nasceria sem vínculo (o gatilho não
      // teria o que preencher) e o cliente não apareceria na grade de
      // avaliação. Falha aqui NÃO derruba o cadastro: cliente é o fato
      // principal; relação e onboarding se reparam depois.
      // A sequência mora em services/client-lifecycle porque a importação por
      // planilha precisa exatamente da mesma — e não passava por aqui (F1.21).
      await abrirVidaDoCliente(id, {
        status: parsed.status,
        startedAt: parsed.startedAt ?? undefined,
        modality: modality === "MRR" || modality === "TCV" ? modality : null,
        monthlyValue: parsed.monthlyValue ?? null,
        totalContractValue: parsed.totalContractValue ?? null,
        contractMonths: parsed.contractMonths ?? null,
      });

      // ===== Fechamento do contrato (venda) no cadastro =====
      // Com uma modalidade escolhida, cria o contrato e gera as cobranças.
      // MRR: mensalidade recorrente a partir da entrada (pelo prazo, ou aberto).
      // TCV: valor CHEIO uma única vez no mês da entrada — NUNCA rateado.
      if (modality === "MRR" || modality === "TCV") {
        const months = parsed.contractMonths; // TCV: obrigatório; MRR: opcional
        // Âncora do contrato = data de entrada/fechamento; MRR sem entrada = hoje.
        const entry = parsed.startedAt ?? new Date();
        const monthly = modality === "MRR" ? parsed.monthlyValue ?? 0 : 0;
        const total =
          modality === "TCV"
            ? parsed.totalContractValue ?? 0
            : Math.round(monthly * (months ?? 12) * 100) / 100;
        // MRR vence no dia recorrente; TCV é pago no ato (dia da entrada).
        const billingDay = modality === "MRR" ? parsed.paymentDay ?? 5 : entry.getDate();
        // Início do contrato clampado ao último dia válido do mês (§8).
        const startDate = getValidDueDateForMonth(
          entry.getFullYear(),
          entry.getMonth() + 1,
          billingDay
        );
        // Fim = último dia do mês final do prazo (quando há prazo definido).
        const endDate = months
          ? new Date(startDate.getFullYear(), startDate.getMonth() + months, 0)
          : null;

        const contract = await prisma.contract.create({
          data: {
            clientId: created.id,
            title: `Contrato ${parsed.name} — ${modality}`,
            type: modality,
            recurrence: modality === "MRR" ? "MONTHLY" : "NONE",
            monthlyValue: monthly,
            totalValue: total,
            startDate,
            endDate,
            renewalDate: endDate,
            billingDay,
            status: "ACTIVE",
          },
        });
        // Gera as cobranças: recorrentes p/ MRR; ÚNICA e CHEIA p/ TCV (sem rateio).
        const { generateBillingsForContract } = await import(
          "@/lib/services/contract-metrics"
        );
        await generateBillingsForContract(contract.id);
        // Sem data de entrada informada, a entrada é hoje — e a expectativa
        // de renovação nasce dela + prazo (a mesma regra do cadastro).
        const complemento: { startedAt?: Date; expectedRenewalAt?: Date | null } = {};
        if (!parsed.startedAt) {
          complemento.startedAt = entry;
          complemento.expectedRenewalAt = expectationFromBase(entry, months ?? null);
        }
        if (Object.keys(complemento).length > 0) {
          await prisma.client.update({
            where: { id: created.id },
            data: complemento,
          });
        }
      }
    }

    return { ok: true, id };
  });
}

const CLIENT_STATUS_TEXT: Record<string, string> = {
  LEAD: "Lead", PROSPECT: "Prospect", ACTIVE: "Ativo", INACTIVE: "Inativo", PAUSED: "Pausado",
  RENEWAL: "Em renovação", DELINQUENT: "Inadimplente", CHURNED: "Perdido",
};

export type RegistrarPerdaInput = {
  clientId: string;
  /** Data da saída, "YYYY-MM-DD". Futura = saída PROGRAMADA. */
  lostAt: string;
  reason?: string | null;
  /** "Não renovou" do módulo Renovações: competência (YYYY-MM) em exibição. */
  renewalCompetence?: string | null;
};

/**
 * PERDA DE CLIENTE com data e motivo (botão "Perda" / "Não renovou").
 * Extraída de actions/clients.ts (markClientLost) sem mudança de regra: a
 * saída entra na linha do tempo a partir da data; perda, relação, termo e
 * cobranças futuras acompanham pela transição.
 */
export async function registrarPerdaDeCliente(
  ctx: DomainContext,
  input: RegistrarPerdaInput
): Promise<DomainResult> {
  return inDomain(ctx, async () => {
    const id = input.clientId;
    const reason = input.reason;
    const renewalCompetence = input.renewalCompetence;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input.lostAt ?? "").trim());
    if (!m) return { ok: false, error: "Informe a data da saída." };
    // Meio-dia local evita a data "voltar um dia" por fuso horário.
    const lostAt = new Date(+m[1], +m[2] - 1, +m[3], 12);
    if (isNaN(lostAt.getTime())) return { ok: false, error: "Data da saída inválida." };

    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };

    const text = (reason ?? "").trim() || null;
    const competencia = parseCompetenceKey(renewalCompetence ?? "") ? renewalCompetence! : null;
    const dia = `${m[1]}-${m[2]}-${m[3]}`;
    if (existing.status === "CHURNED") {
      // Já estava perdido: atualiza a perda mais recente (data/motivo) em vez
      // de duplicar o registro, e a saída passa a valer desde a data informada.
      const last = await prisma.clientLoss.findFirst({
        where: { clientId: id },
        orderBy: { lostAt: "desc" },
        select: { id: true },
      });
      if (last) {
        await prisma.clientLoss.updateMany({
          where: { id: last.id },
          data: {
            lostAt,
            ...(text ? { reason: text } : {}),
            ...(competencia ? { renewalCompetence: competencia } : {}),
          },
        });
      } else {
        await recordLosses([id], text, lostAt, competencia);
      }
    }
    // A saída entra na LINHA DO TEMPO a partir da data informada: os meses
    // anteriores continuam com o status que tinham. Perda, relação, termo e
    // cobranças futuras acompanham pela transição (sincronizarStatusAtual).
    // Data futura = saída PROGRAMADA (não mexe no status de hoje).
    const { changeClientStatus, getClientStatusTimeline, describeInterval } = await import("@/lib/clients/status-history");
    const { todayKey } = await import("@/lib/competence");
    // Um status já registrado DEPOIS da data informada (ex.: a entrada do
    // cliente) continua valendo — a saída não o apaga em silêncio. O gesto
    // "Perda" precisa deixar o cliente perdido; se não deixaria, explica.
    const posterior = (await getClientStatusTimeline(id)).find(
      (i) => i.from > dia && i.from <= todayKey() && i.status !== "CHURNED"
    );
    if (posterior)
      return {
        ok: false,
        error: `Há um status registrado depois dessa data (${CLIENT_STATUS_TEXT[posterior.status] ?? posterior.status} ${describeInterval(posterior)}). Informe uma data de saída posterior ou ajuste o histórico em "Alterar status".`,
      };
    const r = await changeClientStatus(
      { clientId: id, status: "CHURNED", effectiveFrom: dia, reason: text, actor: domainActor(ctx), renewalCompetence: competencia },
      statusCapabilities(ctx)
    );
    if (r.aviso) return { ok: false, error: r.aviso };

    return { ok: true };
  });
}
