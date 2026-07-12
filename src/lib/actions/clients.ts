"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ClientStatus, ClientModality, DelinquencyStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, parseMonthParam } from "@/lib/format";

/**
 * Resultado padrão das mutations (Etapa 1). Toda ação retorna um objeto
 * discriminável para a UI tratar sucesso/erro sem depender de exceptions
 * atravessando o boundary de Server Action.
 */
export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const ClientSchema = z.object({
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
  paymentDay: z
    .number()
    .int()
    .min(1, "Dia entre 1 e 28.")
    .max(28, "Dia entre 1 e 28.")
    .nullable(),
  tags: z.array(z.string().trim().min(1)).default([]),
  status: z.nativeEnum(ClientStatus),
  monthlyValue: z.number().nonnegative("Valor não pode ser negativo.").nullable(),
  startedAt: z.date().nullable(),
  notes: z.string().trim().nullable(),
});

/** Normaliza um campo do FormData: string vazia vira null. */
function clean(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}

/**
 * Registra a PERDA (ClientLoss) dos clientes que estão virando CHURNED:
 * snapshot da receita perdida (MRR mensal / TCV de referência), modalidade,
 * responsável e motivo. Chamado em toda transição de status → Perdido.
 */
async function recordLosses(clientIds: string[], reason?: string | null) {
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
      monthlyValue: (() => {
        const raw = clean(formData.get("monthlyValue"));
        return raw == null ? null : parseBRL(raw);
      })(),
      startedAt: (() => {
        const raw = clean(formData.get("startedAt"));
        return raw == null ? null : parseDateBR(raw);
      })(),
      notes: clean(formData.get("notes")),
    });

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
      paymentDay: parsed.paymentDay,
      tags: parsed.tags,
      status: parsed.status,
      monthlyValue: parsed.monthlyValue,
      startedAt: parsed.startedAt,
      notes: parsed.notes,
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

      // ===== Modelo de pagamento no cadastro → cria o contrato + cobranças =====
      // MRR: valor total ÷ prazo = mensal, recorrente enquanto durar o contrato.
      // TCV: valor cheio lançado uma vez no mês escolhido ("mês de lançamento").
      const model = clean(formData.get("paymentModel")); // "MRR" | "TCV" | null
      const totalRaw = clean(formData.get("contractTotal"));
      const monthsRaw = clean(formData.get("contractMonths"));
      const launch = clean(formData.get("launchMonth")); // "YYYY-MM" (TCV)

      if ((model === "MRR" || model === "TCV") && totalRaw) {
        const total = parseBRL(totalRaw);
        const months = monthsRaw ? Math.max(1, parseInt(monthsRaw, 10)) : null;
        if (!(total > 0)) return { ok: false, error: "Informe o valor total do contrato." };
        if (model === "MRR" && !months)
          return { ok: false, error: "Informe o prazo (meses) do contrato MRR." };
        if (model === "TCV" && !launch)
          return { ok: false, error: "Informe o mês de lançamento da venda (TCV)." };

        const billingDay = parsed.paymentDay ?? 5;
        let startDate: Date;
        if (model === "TCV") {
          const lp = parseMonthParam(launch);
          if (!lp)
            return { ok: false, error: "Mês de lançamento inválido — confira o mês/ano." };
          startDate = new Date(lp.year, lp.month - 1, Math.min(billingDay, 28));
        } else {
          startDate = parsed.startedAt ?? new Date();
        }
        const term = months ?? 12;
        const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + term, startDate.getDate());
        endDate.setDate(endDate.getDate() - 1);
        const monthly = model === "MRR" ? Math.round((total / term) * 100) / 100 : 0;

        const contract = await prisma.contract.create({
          data: {
            clientId: created.id,
            title: `Contrato ${parsed.name} — ${model}`,
            type: model,
            recurrence: model === "MRR" ? "MONTHLY" : "NONE",
            monthlyValue: monthly,
            totalValue: total,
            startDate,
            endDate,
            renewalDate: endDate,
            billingDay,
            status: "ACTIVE",
          },
        });
        // Gera as cobranças (recorrentes até o fim p/ MRR; única no mês p/ TCV)
        const { generateBillingsForContract } = await import(
          "@/lib/services/contract-metrics"
        );
        await generateBillingsForContract(contract.id);
        // MRR de referência do cliente
        if (model === "MRR") {
          await prisma.client.update({ where: { id: created.id }, data: { monthlyValue: monthly } });
        }
        revalidatePath("/acordos");
        revalidatePath("/cobrancas");
      }
    }

    revalidatePath("/clientes");
    revalidatePath("/dashboard");
    return { ok: true, id };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o cliente.";
    return { ok: false, error: msg };
  }
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
{"name": string|null, "legalName": string|null, "document": string|null, "email": string|null, "phone": string|null, "city": string|null, "state": string|null (sigla UF), "address": string|null (endereço completo do contratante), "legalRepresentative": string|null (nome do representante legal que assina), "segment": string|null, "paymentModel": "MRR"|"TCV"|null, "contractTotal": string|null (ex: "5100,00"), "contractMonths": string|null (nº de meses do contrato), "paymentDay": string|null (dia de vencimento 1-28), "startedAt": string|null (data de início dd/mm/aaaa), "notes": string|null (resumo de serviços/condições em 1 frase)}
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
    // deleteMany é escopado por dono → só remove cliente do próprio owner.
    await prisma.client.deleteMany({ where: { id } });
    revalidatePath("/clientes");
    revalidatePath("/dashboard");
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
    revalidatePath("/clientes");
    revalidatePath(`/clientes/${id}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar o status.";
    return { ok: false, error: msg };
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
    revalidatePath("/clientes");
    revalidatePath("/dashboard");
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
    revalidatePath("/clientes");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar a modalidade.";
    return { ok: false, error: msg };
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
    revalidatePath("/clientes");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar o mês de renovação.";
    return { ok: false, error: msg };
  }
}

/**
 * Override manual da inadimplência do mês atual (Pago/Devendo).
 * Grava valor + competência (mês/ano correntes) + quem/quando ajustou.
 * `status = null` limpa o override e volta ao cálculo automático.
 */
export async function setClientDelinquency(
  id: string,
  status: string | null
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    const value =
      status == null || status === ""
        ? null
        : z.nativeEnum(DelinquencyStatus).parse(status);
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };

    if (value == null) {
      await prisma.client.update({
        where: { id },
        data: {
          delinquencyOverride: null,
          delinquencyOverrideMonth: null,
          delinquencyOverrideYear: null,
          delinquencyOverrideAt: null,
          delinquencyOverrideBy: null,
        },
      });
    } else {
      const now = new Date();
      await prisma.client.update({
        where: { id },
        data: {
          delinquencyOverride: value,
          delinquencyOverrideMonth: now.getMonth() + 1,
          delinquencyOverrideYear: now.getFullYear(),
          delinquencyOverrideAt: now,
          delinquencyOverrideBy: viewer.name,
        },
      });
    }
    revalidatePath("/clientes");
    revalidatePath("/dashboard");
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
  paymentDay: z.number().int().min(1).max(28).nullish(),
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
    revalidatePath("/clientes");
    revalidatePath("/dashboard");
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
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
    revalidatePath("/clientes");
    revalidatePath("/dashboard");
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

    revalidatePath(`/clientes/${parsed.clientId}`);
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
    revalidatePath(`/clientes/${existing.clientId}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o contato." };
  }
}
