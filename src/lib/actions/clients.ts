"use server";
import { prisma } from "@/lib/prisma";
import { revalidateAgency } from "@/lib/revalidate";
import { z } from "zod";
import { ClientStatus, ClientModality, DelinquencyStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, clean } from "@/lib/format";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";

/**
 * Resultado padrão das mutations (Etapa 1). Toda ação retorna um objeto
 * discriminável para a UI tratar sucesso/erro sem depender de exceptions
 * atravessando o boundary de Server Action.
 */
export type ActionResult =
  | { ok: true; id?: string; warning?: string }
  | { ok: false; error: string };

const ClientSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, "Informe o nome do cliente."),
    legalName: z.string().trim().nullable(),
    document: z.string().trim().nullable(),
    email: z
      .union([z.string().trim().email("E-mail inválido."), z.literal(""), z.null()])
      .transform((v) => (v ? v : null)),
    phone: z.string().trim().nullable(),
    segment: z.string().trim().nullable(),
    city: z.string().trim().nullable(),
    state: z.string().trim().max(2, "Use a sigla da UF (ex.: BA).").nullable(),
    address: z.string().trim().nullable(),
    legalRepresentative: z.string().trim().nullable(),
    origin: z.string().trim().nullable(),
    salesOwner: z.string().trim().nullable(),
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
      if (v.contractMonths == null)
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

/** Normaliza um campo do FormData: string vazia vira null. */

/**
 * Registra a PERDA (ClientLoss) dos clientes que estão virando CHURNED:
 * snapshot da receita perdida (MRR mensal / TCV de referência), modalidade,
 * responsável e motivo. Chamado em toda transição de status → Perdido.
 */
async function recordLosses(
  clientIds: string[],
  reason?: string | null,
  lostAt?: Date
) {
  if (clientIds.length === 0) return;
  const { computeLossSnapshots } = await import("@/lib/services/revenue-metrics");
  const snapshots = await computeLossSnapshots(clientIds);
  if (snapshots.length === 0) return;
  await prisma.clientLoss.createMany({
    data: snapshots.map((s) => ({
      clientId: s.clientId,
      modality: s.modality as any,
      monthlyValue: s.monthlyValue,
      referenceValue: s.referenceValue,
      salesOwner: s.salesOwner,
      reason: reason ?? null,
      // Data informada pelo gestor (botão Perda); default do banco = agora.
      ...(lostAt ? { lostAt } : {}),
    })),
  });
}

export async function saveClient(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = ClientSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      name: String(formData.get("name") ?? "").trim(),
      legalName: clean(formData.get("legalName")),
      document: clean(formData.get("document")),
      email: clean(formData.get("email")),
      phone: clean(formData.get("phone")),
      segment: clean(formData.get("segment")),
      city: clean(formData.get("city")),
      state: clean(formData.get("state"))?.toUpperCase() ?? null,
      address: clean(formData.get("address")),
      legalRepresentative: clean(formData.get("legalRepresentative")),
      origin: clean(formData.get("origin")),
      salesOwner: clean(formData.get("salesOwner")),
      opsOwner: clean(formData.get("opsOwner")),
      paymentDay: (() => {
        const raw = clean(formData.get("paymentDay"));
        return raw == null ? null : parseInt(raw, 10);
      })(),
      tags: (clean(formData.get("tags")) ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      status: (clean(formData.get("status")) ?? "ACTIVE") as ClientStatus,
      modality: (() => {
        const raw = clean(formData.get("paymentModel"));
        return raw === "MRR" || raw === "TCV" ? (raw as ClientModality) : null;
      })(),
      monthlyValue: (() => {
        const raw = clean(formData.get("monthlyValue"));
        return raw == null ? null : parseBRL(raw);
      })(),
      totalContractValue: (() => {
        const raw = clean(formData.get("totalContractValue"));
        return raw == null ? null : parseBRL(raw);
      })(),
      contractMonths: (() => {
        const raw = clean(formData.get("contractMonths"));
        return raw == null ? null : Math.max(1, parseInt(raw, 10) || 0) || null;
      })(),
      startedAt: (() => {
        const raw = clean(formData.get("startedAt"));
        return raw == null ? null : parseDateBR(raw);
      })(),
      notes: clean(formData.get("notes")),
    });

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
          }
        : modality === "TCV"
          ? {
              modality,
              monthlyValue: null, // TCV não tem mensalidade recorrente
              totalContractValue: parsed.totalContractValue,
              paymentDay: null, // TCV não tem dia recorrente de pagamento
              contractMonths: parsed.contractMonths,
            }
          : {
              modality: null,
              monthlyValue: parsed.monthlyValue,
              totalContractValue: parsed.totalContractValue,
              paymentDay: parsed.paymentDay,
              contractMonths: parsed.contractMonths,
            };

    const base = {
      name: parsed.name,
      legalName: parsed.legalName,
      document: parsed.document,
      email: parsed.email,
      phone: parsed.phone,
      segment: parsed.segment,
      city: parsed.city,
      state: parsed.state,
      address: parsed.address,
      legalRepresentative: parsed.legalRepresentative,
      origin: parsed.origin,
      salesOwner: parsed.salesOwner,
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
      // Transição → Perdido pela edição também registra a perda.
      if (parsed.status === "CHURNED" && existing.status !== "CHURNED") {
        await recordLosses([id]);
      }
      await prisma.client.update({
        where: { id },
        data: {
          ...base,
          // Preserva o churn original; limpa se saiu do status CHURNED.
          churnedAt:
            parsed.status === "CHURNED" ? existing.churnedAt ?? new Date() : null,
        },
      });
    } else {
      const created = await prisma.client.create({
        data: {
          ...base,
          churnedAt: parsed.status === "CHURNED" ? new Date() : null,
        },
      });
      id = created.id;

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
        // Garante a data de entrada no cadastro quando não informada.
        if (!parsed.startedAt) {
          await prisma.client.update({
            where: { id: created.id },
            data: { startedAt: entry },
          });
        }
      }
    }

    revalidateAgency({ clientId: id });

    return { ok: true, id };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o cliente.";
    return { ok: false, error: msg };
  }
}

/**
 * Carrega o registro COMPLETO do cliente para o formulário de edição.
 * A lista da carteira usa uma projeção enxuta (performance); o formulário
 * precisa de todos os campos editáveis para não sobrescrever com vazio ao
 * salvar. Serializa Decimals/Datas para tipos simples atravessáveis.
 */
export type ClientEditData = {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  segment: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  legalRepresentative: string | null;
  origin: string | null;
  salesOwner: string | null;
  opsOwner: string | null;
  status: string;
  modality: string | null;
  paymentDay: number | null;
  monthlyValue: number | null;
  totalContractValue: number | null;
  contractMonths: number | null;
  startedAt: string | null; // ISO
  tags: string[];
  notes: string | null;
};

export async function getClientForEdit(id: string): Promise<ClientEditData | null> {
  await requireAdmin();
  const c = await prisma.client.findUnique({ where: { id } });
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    legalName: c.legalName,
    document: c.document,
    email: c.email,
    phone: c.phone,
    segment: c.segment,
    city: c.city,
    state: c.state,
    address: c.address,
    legalRepresentative: c.legalRepresentative,
    origin: c.origin,
    salesOwner: c.salesOwner,
    opsOwner: c.opsOwner,
    status: c.status,
    modality: c.modality,
    paymentDay: c.paymentDay,
    monthlyValue: c.monthlyValue != null ? Number(c.monthlyValue) : null,
    totalContractValue: c.totalContractValue != null ? Number(c.totalContractValue) : null,
    contractMonths: c.contractMonths,
    startedAt: c.startedAt ? c.startedAt.toISOString() : null,
    tags: c.tags,
    notes: c.notes,
  };
}

// ---------- Cadastro por contrato (PDF + IA) ----------

export type ContractExtraction = {
  ok: true;
  data: Record<string, string>;
  missing: string[];
} | { ok: false; error: string };

/**
 * Lê um contrato em PDF e extrai os dados do cliente com a IA configurada.
 * Nada é gravado — o resultado pré-preenche o formulário de novo cliente e
 * o usuário completa apenas o que faltar.
 */
export async function extractClientFromContract(formData: FormData): Promise<ContractExtraction> {
  await requireAdmin();
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0)
      return { ok: false, error: "Envie o contrato em PDF." };
    if (file.size > 8 * 1024 * 1024) return { ok: false, error: "PDF acima de 8MB." };

    const { getAISettings, isConfigured, chatComplete } = await import("@/lib/ai/provider");
    const settings = await getAISettings();
    if (!isConfigured(settings))
      return { ok: false, error: "Configure a IA em /assistente para ler contratos." };

    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as any;
    let text = "";
    try {
      const parsed = await pdfParse(Buffer.from(await file.arrayBuffer()));
      text = String(parsed.text ?? "").trim();
    } catch {
      return { ok: false, error: "Não foi possível ler o PDF (protegido ou escaneado?)." };
    }
    if (text.length < 100)
      return { ok: false, error: "PDF sem texto legível — envie um contrato digital (não escaneado)." };

    const system = `Você extrai dados de contratos de prestação de serviços de uma agência de marketing brasileira. Responda APENAS com um JSON válido (sem markdown, sem comentários) no formato:
{"name": string|null, "legalName": string|null, "document": string|null, "email": string|null, "phone": string|null, "city": string|null, "state": string|null (sigla UF), "address": string|null (endereço completo do contratante), "legalRepresentative": string|null (nome do representante legal que assina), "segment": string|null, "paymentModel": "MRR"|"TCV"|null, "contractTotal": string|null (ex: "5100,00"), "contractMonths": string|null (nº de meses do contrato), "paymentDay": string|null (dia de vencimento 1-31), "startedAt": string|null (data de início dd/mm/aaaa), "notes": string|null (resumo de serviços/condições em 1 frase)}
Regras: "name" é o nome do CONTRATANTE (cliente), nunca da agência/contratada (B2C, B2C Gestão). paymentModel: "MRR" se o pagamento é mensal/recorrente; "TCV" se é valor fechado do projeto. contractTotal: valor TOTAL do contrato (se só houver mensal e prazo, multiplique). Use null quando o dado não estiver no contrato. NUNCA invente.`;

    const result = await chatComplete({
      settings,
      system,
      messages: [{ role: "user", content: `CONTRATO:\n${text.slice(0, 14000)}` }],
      maxTokens: 700,
    });

    const raw = result.text.replace(/```json|```/g, "").trim();
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));

    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) {
      if (v != null && v !== "" && typeof v !== "object") data[k] = String(v);
    }
    const FIELD_LABEL: Record<string, string> = {
      name: "Nome do cliente", document: "CNPJ/CPF", email: "E-mail", phone: "Telefone",
      paymentModel: "Modelo de pagamento (MRR/TCV)", contractTotal: "Valor total do contrato",
      contractMonths: "Prazo (meses)", paymentDay: "Dia de pagamento",
    };
    const missing = Object.entries(FIELD_LABEL)
      .filter(([k]) => !data[k])
      .map(([, label]) => label);

    return { ok: true, data, missing };
  } catch (e: any) {
    console.error("extractClientFromContract", e);
    return { ok: false, error: "Não consegui interpretar o contrato. Confira o PDF ou cadastre manualmente." };
  }
}

export async function deleteClient(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    // Exclusão profunda: remove cobranças/pagamentos/contratos do cliente
    // na ordem certa (Billing/Contract não têm cascade no banco).
    const { deleteClientsDeep } = await import("@/lib/services/client-purge");
    const res = await deleteClientsDeep([id]);
    if (res.deleted === 0) return { ok: false, error: "Cliente não encontrado." };
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o cliente." };
  }
}

export async function setClientStatus(
  id: string,
  status: string,
  reason?: string | null
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const s = z.nativeEnum(ClientStatus).parse(status);
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };
    // Transição → Perdido registra a perda (data, receita, modalidade, motivo).
    if (s === "CHURNED" && existing.status !== "CHURNED") {
      await recordLosses([id], reason);
    }
    await prisma.client.update({
      where: { id },
      data: {
        status: s,
        churnedAt: s === "CHURNED" ? existing.churnedAt ?? new Date() : null,
      },
    });
    revalidateAgency({ clientId: id });
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar o status.";
    return { ok: false, error: msg };
  }
}

/**
 * PERDA de cliente (botão "Perda" da carteira): registra a saída com a DATA
 * informada pelo gestor + motivo. O cliente vira Perdido (CHURNED), sai da
 * lista padrão de clientes e a perda alimenta os indicadores de churn
 * (Dashboard/Relatórios) com snapshot da receita perdida.
 */
export async function markClientLost(
  id: string,
  lostAtRaw: string,
  reason?: string | null
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(lostAtRaw ?? "").trim());
    if (!m) return { ok: false, error: "Informe a data da saída." };
    // Meio-dia local evita a data "voltar um dia" por fuso horário.
    const lostAt = new Date(+m[1], +m[2] - 1, +m[3], 12);
    if (isNaN(lostAt.getTime())) return { ok: false, error: "Data da saída inválida." };

    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };

    const text = (reason ?? "").trim() || null;
    if (existing.status !== "CHURNED") {
      await recordLosses([id], text, lostAt);
    } else {
      // Já estava perdido: atualiza a perda mais recente (data/motivo)
      // em vez de duplicar o registro.
      const last = await prisma.clientLoss.findFirst({
        where: { clientId: id },
        orderBy: { lostAt: "desc" },
        select: { id: true },
      });
      if (last) {
        await prisma.clientLoss.updateMany({
          where: { id: last.id },
          data: { lostAt, ...(text ? { reason: text } : {}) },
        });
      } else {
        await recordLosses([id], text, lostAt);
      }
    }

    await prisma.client.update({
      where: { id },
      data: { status: "CHURNED", churnedAt: lostAt },
    });

    revalidateAgency({ clientId: id });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao registrar a perda." };
  }
}

/**
 * Define/atualiza o motivo da perda mais recente do cliente (preenchido
 * opcionalmente logo após marcar como Perdido na carteira).
 */
export async function setClientLossReason(
  clientId: string,
  reason: string
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const text = reason.trim();
    if (!text) return { ok: true };
    const last = await prisma.clientLoss.findFirst({
      where: { clientId },
      orderBy: { lostAt: "desc" },
      select: { id: true },
    });
    if (!last) return { ok: false, error: "Registro de perda não encontrado." };
    await prisma.clientLoss.updateMany({
      where: { id: last.id },
      data: { reason: text },
    });
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao salvar o motivo da perda." };
  }
}

/** Modalidade de faturamento (MRR/TCV) — edição inline na carteira. */
export async function setClientModality(
  id: string,
  modality: string | null
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const value =
      modality == null || modality === ""
        ? null
        : z.nativeEnum(ClientModality).parse(modality);
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };
    await prisma.client.update({ where: { id }, data: { modality: value } });
    revalidateAgency({ clientId: id });
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar a modalidade.";
    return { ok: false, error: msg };
  }
}

/** Valor mensal recorrente (MRR) — edição inline na lista de Clientes. */
export async function setClientMonthlyValue(
  id: string,
  raw: string
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const value = raw && raw.trim() ? parseBRL(raw) : null;
    if (value != null && value < 0)
      return { ok: false, error: "Valor não pode ser negativo." };
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };
    await prisma.client.update({ where: { id }, data: { monthlyValue: value } });
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o valor mensal." };
  }
}

/** Mês de renovação (1-12) — edição inline na carteira. */
export async function setClientRenewalMonth(
  id: string,
  month: number | null
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const value =
      month == null
        ? null
        : z.number().int().min(1, "Mês inválido.").max(12, "Mês inválido.").parse(month);
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };
    await prisma.client.update({ where: { id }, data: { renewalMonth: value } });
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar o mês de renovação.";
    return { ok: false, error: msg };
  }
}

/**
 * Override manual da inadimplência POR COMPETÊNCIA (Pago/Devendo).
 * Grava em ClientMonthDelinquency no mês/ano informados (default: mês atual)
 * — cada mês guarda o próprio ajuste, sem apagar os dos outros meses.
 * `status = null` limpa o override daquela competência (volta ao automático).
 */
export async function setClientDelinquency(
  id: string,
  status: string | null,
  refMonth?: number,
  refYear?: number
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    const value =
      status == null || status === ""
        ? null
        : z.nativeEnum(DelinquencyStatus).parse(status);
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };

    const now = new Date();
    const month = refMonth && refMonth >= 1 && refMonth <= 12 ? Math.trunc(refMonth) : now.getMonth() + 1;
    const year = refYear && refYear >= 1990 && refYear <= 2100 ? Math.trunc(refYear) : now.getFullYear();

    if (value == null) {
      await prisma.clientMonthDelinquency.deleteMany({
        where: { clientId: id, month, year },
      });
    } else {
      const current = await prisma.clientMonthDelinquency.findFirst({
        where: { clientId: id, month, year },
        select: { id: true },
      });
      if (current) {
        await prisma.clientMonthDelinquency.updateMany({
          where: { id: current.id },
          data: { status: value, setBy: viewer.name, setAt: now },
        });
      } else {
        await prisma.clientMonthDelinquency.create({
          data: { clientId: id, month, year, status: value, setBy: viewer.name },
        });
      }
    }
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar a inadimplência.";
    return { ok: false, error: msg };
  }
}

// ---------- Ações em massa (seleção múltipla na carteira) ----------

const BulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Selecione ao menos um cliente."),
  status: z.nativeEnum(ClientStatus).nullish(),
  salesOwner: z.string().trim().nullish(),
  renewalMonth: z.number().int().min(1).max(12).nullish(),
  modality: z.nativeEnum(ClientModality).nullish(),
  paymentDay: z.number().int().min(1).max(31).nullish(),
});

/**
 * Atualiza em massa os clientes selecionados (updateMany é escopado por dono
 * pela extensão do Prisma — só afeta clientes do próprio owner). Aplica só os
 * campos enviados; ausência de campo = não altera.
 */
export async function bulkUpdateClients(input: {
  ids: string[];
  status?: string | null;
  salesOwner?: string | null;
  renewalMonth?: number | null;
  modality?: string | null;
  paymentDay?: number | null;
}): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = BulkSchema.parse({
      ids: input.ids,
      status: input.status ? (input.status as ClientStatus) : undefined,
      salesOwner:
        input.salesOwner === undefined ? undefined : (input.salesOwner || null),
      renewalMonth: input.renewalMonth ?? undefined,
      modality: input.modality ? (input.modality as ClientModality) : undefined,
      paymentDay: input.paymentDay ?? undefined,
    });

    const data: Record<string, any> = {};
    if (parsed.status) {
      data.status = parsed.status;
      // Mantém churnedAt coerente ao mudar status em massa.
      if (parsed.status === "CHURNED") data.churnedAt = new Date();
      else data.churnedAt = null;
    }
    if (parsed.salesOwner !== undefined) data.salesOwner = parsed.salesOwner;
    if (parsed.renewalMonth !== undefined) data.renewalMonth = parsed.renewalMonth;
    if (parsed.modality !== undefined && parsed.modality !== null)
      data.modality = parsed.modality;
    if (parsed.paymentDay !== undefined && parsed.paymentDay !== null)
      data.paymentDay = parsed.paymentDay;

    if (Object.keys(data).length === 0)
      return { ok: false, error: "Nada para atualizar." };

    // Transição em massa → Perdido: registra a perda de quem ainda não era.
    if (parsed.status === "CHURNED") {
      const transitioning = await prisma.client.findMany({
        where: { id: { in: parsed.ids }, status: { not: "CHURNED" } },
        select: { id: true },
      });
      await recordLosses(transitioning.map((c) => c.id));
    }

    await prisma.client.updateMany({ where: { id: { in: parsed.ids } }, data });
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar em massa.";
    return { ok: false, error: msg };
  }
}

/** Exclusão em massa (deleteMany é escopado por dono). */
export async function bulkDeleteClients(ids: string[]): Promise<ActionResult> {
  await requireAdmin();
  try {
    if (!ids.length) return { ok: false, error: "Selecione ao menos um cliente." };
    const { deleteClientsDeep } = await import("@/lib/services/client-purge");
    await deleteClientsDeep(ids);
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir em massa." };
  }
}

// ---------- Contatos do cliente ----------

const ContactSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1),
  name: z.string().trim().min(1, "Informe o nome do contato."),
  role: z.string().trim().nullable(),
  email: z
    .union([z.string().trim().email("E-mail inválido."), z.literal(""), z.null()])
    .transform((v) => (v ? v : null)),
  phone: z.string().trim().nullable(),
  isPrimary: z.boolean().default(false),
  notes: z.string().trim().nullable(),
});

export async function saveClientContact(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = ContactSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      clientId: String(formData.get("clientId") ?? ""),
      name: String(formData.get("name") ?? "").trim(),
      role: clean(formData.get("role")),
      email: clean(formData.get("email")),
      phone: clean(formData.get("phone")),
      isPrimary: formData.get("isPrimary") === "on",
      notes: clean(formData.get("notes")),
    });

    // Confirma que o cliente pertence ao dono atual (findFirst é escopado).
    const owned = await prisma.client.findFirst({
      where: { id: parsed.clientId },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    const data = {
      clientId: parsed.clientId,
      name: parsed.name,
      role: parsed.role,
      email: parsed.email,
      phone: parsed.phone,
      isPrimary: parsed.isPrimary,
      notes: parsed.notes,
    };

    if (parsed.isPrimary) {
      // Só um contato principal por cliente.
      await prisma.clientContact.updateMany({
        where: { clientId: parsed.clientId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    if (parsed.id) {
      const existing = await prisma.clientContact.findUnique({
        where: { id: parsed.id },
      });
      if (!existing) return { ok: false, error: "Contato não encontrado." };
      await prisma.clientContact.update({ where: { id: parsed.id }, data });
    } else {
      await prisma.clientContact.create({ data });
    }

    revalidateAgency({ clientId: parsed.clientId });
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o contato.";
    return { ok: false, error: msg };
  }
}

export async function deleteClientContact(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const existing = await prisma.clientContact.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Contato não encontrado." };
    await prisma.clientContact.deleteMany({ where: { id } });
    revalidateAgency({ clientId: existing.clientId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o contato." };
  }
}
