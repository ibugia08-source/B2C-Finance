"use server";
import { prisma } from "@/lib/prisma";
import { revalidateAgency } from "@/lib/revalidate";
import { z } from "zod";
import { ClientStatus, ClientModality } from "@prisma/client";
import { requirePermission, tryPermission, NO_PERMISSION } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, clean } from "@/lib/format";
import { registrarPerdaDeCliente, salvarCliente, type ClientInput } from "@/lib/services/client-service";
import { domainContextFor } from "@/lib/auth/domain-session";
import { domainActor, statusCapabilities } from "@/lib/engines/domain";
import {
  PRAZO_INDETERMINADO, expectationInMonth, parseCompetenceKey,
} from "@/lib/renewal-expectation";


/**
 * Capacidades de status do usuário logado (RBAC existente), pelo MESMO
 * contexto de domínio que as funções extraídas usam. Toda troca de status
 * passa pela linha do tempo (src/lib/clients/status-history.ts).
 */
async function capacidadesDeStatus() {
  const { getViewer } = await import("@/lib/auth/viewer");
  const ctx = await domainContextFor(await getViewer());
  return { actor: domainActor(ctx), caps: statusCapabilities(ctx) };
}

/**
 * Resultado padrão das mutations (Etapa 1). Toda ação retorna um objeto
 * discriminável para a UI tratar sucesso/erro sem depender de exceptions
 * atravessando o boundary de Server Action.
 */
export type ActionResult =
  | { ok: true; id?: string; warning?: string }
  | { ok: false; error: string; code?: "DUPLICADO_NOME" };

export async function saveClient(formData: FormData): Promise<ActionResult> {
  const viewer = await tryPermission("clientes.editar");
  if (!viewer) return NO_PERMISSION;
  try {
    // Formulário → entrada tipada; a REGRA está em services/client-service
    // (a mesma que a API vai usar).
    const input: ClientInput = {
      id: clean(formData.get("id")) ?? undefined,
      name: String(formData.get("name") ?? "").trim(),
      legalName: clean(formData.get("legalName")),
      document: clean(formData.get("document")),
      email: clean(formData.get("email")),
      phone: clean(formData.get("phone")),
      nicheId: clean(formData.get("nicheId")),
      city: clean(formData.get("city")),
      state: clean(formData.get("state"))?.toUpperCase() ?? null,
      address: clean(formData.get("address")),
      legalRepresentative: clean(formData.get("legalRepresentative")),
      origin: clean(formData.get("origin")),
      salesOwnerId: clean(formData.get("salesOwnerId")),
      opsOwner: clean(formData.get("opsOwner")),
      paymentDay: (() => {
        const raw = clean(formData.get("paymentDay"));
        return raw == null ? null : parseInt(raw, 10);
      })(),
      // Tags em minúsculas e sem repetição: a busca da carteira procura a tag
      // em minúsculas, e "VIP" gravado assim nunca era encontrado.
      tags: Array.from(
        new Set(
          (clean(formData.get("tags")) ?? "")
            .split(",")
            .map((t) => t.trim().toLocaleLowerCase("pt-BR"))
            .filter(Boolean)
        )
      ),
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
        if (raw == null || raw.toLowerCase() === PRAZO_INDETERMINADO) return null;
        return Math.max(1, parseInt(raw, 10) || 0) || null;
      })(),
      contractIndefinite: clean(formData.get("contractMonths"))?.toLowerCase() === PRAZO_INDETERMINADO,
      startedAt: (() => {
        const raw = clean(formData.get("startedAt"));
        return raw == null ? null : parseDateBR(raw);
      })(),
      notes: clean(formData.get("notes")),
      permitirDuplicado: clean(formData.get("permitirDuplicado")) === "1",
    };
    const r = await salvarCliente(await domainContextFor(viewer), input);
    if (!r.ok) return r;
    revalidateAgency({ clientId: r.id });
    return { ok: true, id: r.id };
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
  nicheId: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  legalRepresentative: string | null;
  origin: string | null;
  salesOwner: string | null;
  salesOwnerId: string | null;
  opsOwner: string | null;
  status: string;
  modality: string | null;
  paymentDay: number | null;
  monthlyValue: number | null;
  totalContractValue: number | null;
  contractMonths: number | null;
  contractIndefinite: boolean;
  startedAt: string | null; // ISO
  tags: string[];
  notes: string | null;
};

export async function getClientForEdit(id: string): Promise<ClientEditData | null> {
  await requirePermission("clientes.visualizar");
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
    nicheId: c.nicheId,
    city: c.city,
    state: c.state,
    address: c.address,
    legalRepresentative: c.legalRepresentative,
    origin: c.origin,
    salesOwner: c.salesOwner,
    salesOwnerId: c.salesOwnerId,
    opsOwner: c.opsOwner,
    status: c.status,
    modality: c.modality,
    paymentDay: c.paymentDay,
    monthlyValue: c.monthlyValue != null ? Number(c.monthlyValue) : null,
    totalContractValue: c.totalContractValue != null ? Number(c.totalContractValue) : null,
    contractMonths: c.contractMonths,
    contractIndefinite: c.contractIndefinite,
    startedAt: c.startedAt ? c.startedAt.toISOString() : null,
    tags: c.tags,
    notes: c.notes,
  };
}

/**
 * Colaboradores ativos para o select de "Responsável" do cliente.
 * Permissão de clientes (não de folha): quem edita cliente pode não ter
 * acesso à folha. Escopo por dono é automático (Employee ∈ OWNED_MODELS).
 */
export async function listEmployeeOptions(): Promise<{ id: string; name: string }[]> {
  await requirePermission("clientes.visualizar");
  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return employees;
}

export async function deleteClient(id: string): Promise<ActionResult> {
  await requirePermission("clientes.excluir");
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
  if (!(await tryPermission("clientes.alterar_status"))) return NO_PERMISSION;
  try {
    // Compatibilidade: sem data informada, vale A PARTIR DE HOJE — nunca
    // reescreve os meses anteriores. A interface usa changeClientStatusAction.
    const s = z.nativeEnum(ClientStatus).parse(status);
    const { changeClientStatus } = await import("@/lib/clients/status-history");
    const { todayKey } = await import("@/lib/competence");
    const { actor, caps } = await capacidadesDeStatus();
    await changeClientStatus({ clientId: id, status: s, effectiveFrom: todayKey(), reason, actor }, caps);
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
  reason?: string | null,
  /** "Não renovou" do módulo Renovações: competência (YYYY-MM) em exibição. */
  renewalCompetence?: string | null
): Promise<ActionResult> {
  const viewer = await tryPermission("clientes.alterar_status");
  if (!viewer) return NO_PERMISSION;
  try {
    // A regra está em services/client-service (a mesma da API).
    const r = await registrarPerdaDeCliente(await domainContextFor(viewer), {
      clientId: id, lostAt: lostAtRaw, reason, renewalCompetence,
    });
    if (!r.ok) return r;
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
  if (!(await tryPermission("clientes.alterar_status"))) return NO_PERMISSION;
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
  if (!(await tryPermission("clientes.editar"))) return NO_PERMISSION;
  try {
    const value =
      modality == null || modality === ""
        ? null
        : z.nativeEnum(ClientModality).parse(modality);
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };
    // Mesmas regras do cadastro (auditoria 25/09/2026): TCV exige valor total
    // e prazo — sem eles o cliente nunca aparece em Renovações — e TCV não tem
    // mensalidade nem dia recorrente. Faltando dado, o caminho é o formulário.
    if (value === "TCV") {
      if (!(Number(existing.totalContractValue) > 0) || !existing.contractMonths)
        return {
          ok: false,
          error: "Para TCV, informe o valor total e o prazo do contrato no cadastro do cliente (Editar).",
        };
      await prisma.client.update({
        where: { id },
        data: { modality: "TCV", monthlyValue: null, paymentDay: null },
      });
    } else if (value === "MRR") {
      if (!(Number(existing.monthlyValue) > 0))
        return {
          ok: false,
          error: "Para MRR, informe a mensalidade no cadastro do cliente (Editar).",
        };
      await prisma.client.update({
        where: { id },
        data: { modality: "MRR", totalContractValue: null },
      });
    } else {
      await prisma.client.update({ where: { id }, data: { modality: null } });
    }
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
  if (!(await tryPermission("clientes.editar"))) return NO_PERMISSION;
  try {
    const value = raw && raw.trim() ? parseBRL(raw) : null;
    if (value != null && value < 0)
      return { ok: false, error: "Valor não pode ser negativo." };
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };
    if (existing.modality === "TCV")
      return {
        ok: false,
        error: "Cliente TCV não tem mensalidade — o valor dele é o total do contrato (Editar).",
      };
    await prisma.client.update({ where: { id }, data: { monthlyValue: value } });
    revalidateAgency({ clientId: id });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o valor mensal." };
  }
}

/**
 * Expectativa de renovação — edição inline na carteira. Recebe a
 * competência "YYYY-MM" (ou vazio para limpar) e grava a data no dia do
 * ciclo do cliente. É o mesmo gesto do "Agendar renovação".
 */
export async function setClientRenewalExpectation(
  id: string,
  competence: string | null
): Promise<ActionResult> {
  if (!(await tryPermission("clientes.editar"))) return NO_PERMISSION;
  try {
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Cliente não encontrado." };
    let value: Date | null = null;
    if (competence) {
      const ym = parseCompetenceKey(competence);
      if (!ym) return { ok: false, error: "Mês inválido." };
      value = expectationInMonth(ym, existing.startedAt);
    }
    await prisma.client.update({ where: { id }, data: { expectedRenewalAt: value } });
    revalidateAgency({ clientId: id });
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar a expectativa de renovação.";
    return { ok: false, error: msg };
  }
}

// ---------- Ações em massa (seleção múltipla na carteira) ----------

const BulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Selecione ao menos um cliente."),
  status: z.nativeEnum(ClientStatus).nullish(),
  salesOwner: z.string().trim().nullish(),
  /** Colaborador responsável (id). "" = sem responsável; ausente = não mexe. */
  salesOwnerId: z.string().trim().nullish(),
  /** "YYYY-MM" = agenda a expectativa; "" = limpa; ausente = não mexe. */
  renewalCompetence: z.string().regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/, "Mês inválido.").nullish(),
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
  salesOwnerId?: string | null;
  renewalCompetence?: string | null;
  modality?: string | null;
  paymentDay?: number | null;
}): Promise<ActionResult> {
  if (!(await tryPermission("clientes.editar"))) return NO_PERMISSION;
  try {
    const parsed = BulkSchema.parse({
      ids: input.ids,
      status: input.status ? (input.status as ClientStatus) : undefined,
      salesOwner:
        input.salesOwner === undefined ? undefined : (input.salesOwner || null),
      salesOwnerId: input.salesOwnerId === undefined ? undefined : (input.salesOwnerId ?? ""),
      renewalCompetence: input.renewalCompetence === undefined ? undefined : input.renewalCompetence ?? "",
      modality: input.modality ? (input.modality as ClientModality) : undefined,
      paymentDay: input.paymentDay ?? undefined,
    });

    const data: Record<string, any> = {};
    // Responsável: SEMPRE o par colaborador + nome. Texto livre em massa
    // deixava salesOwnerId apontando para outra pessoa, e o próximo "salvar"
    // do cadastro desfazia a troca (auditoria 25/09/2026).
    if (parsed.salesOwnerId !== undefined && parsed.salesOwnerId !== null) {
      if (parsed.salesOwnerId === "") {
        data.salesOwnerId = null;
        data.salesOwner = null;
      } else {
        const emp = await prisma.employee.findFirst({
          where: { id: parsed.salesOwnerId },
          select: { id: true, name: true },
        });
        if (!emp) return { ok: false, error: "Colaborador responsável não encontrado." };
        data.salesOwnerId = emp.id;
        data.salesOwner = emp.name;
      }
    } else if (parsed.salesOwner !== undefined) {
      // Compatibilidade: nome digitado casa com um colaborador pelo nome.
      const nome = parsed.salesOwner;
      const emp = nome
        ? await prisma.employee.findFirst({
            where: { name: { equals: nome, mode: "insensitive" } },
            select: { id: true, name: true },
          })
        : null;
      data.salesOwner = emp?.name ?? nome;
      data.salesOwnerId = emp?.id ?? null;
    }
    // Expectativa em massa: cada cliente no dia do PRÓPRIO ciclo, então não
    // dá para um updateMany só — vai cliente a cliente depois do lote.
    const agendar =
      parsed.renewalCompetence === undefined || parsed.renewalCompetence === null
        ? undefined
        : parsed.renewalCompetence === ""
          ? null
          : parseCompetenceKey(parsed.renewalCompetence);
    if (parsed.modality !== undefined && parsed.modality !== null)
      data.modality = parsed.modality;
    if (parsed.paymentDay !== undefined && parsed.paymentDay !== null)
      data.paymentDay = parsed.paymentDay;

    if (Object.keys(data).length === 0 && agendar === undefined && !parsed.status)
      return { ok: false, error: "Nada para atualizar." };

    // Status em massa: cliente a cliente, pelo caminho único de transição —
    // perda registrada só para quem muda, churnedAt de quem JÁ tinha saído
    // preservado, relação/termo/cobranças futuras acompanhando.
    if (parsed.status) {
      // A PARTIR DE HOJE, pela linha do tempo. Vigência em outra data:
      // bulkChangeClientStatusAction (diálogo da ação em massa).
      const { changeClientStatus } = await import("@/lib/clients/status-history");
      const { todayKey } = await import("@/lib/competence");
      const { actor, caps } = await capacidadesDeStatus();
      const alvos = await prisma.client.findMany({ where: { id: { in: parsed.ids } }, select: { id: true } });
      for (const c of alvos)
        await changeClientStatus({ clientId: c.id, status: parsed.status, effectiveFrom: todayKey(), actor }, caps);
    }

    if (Object.keys(data).length > 0) {
      await prisma.client.updateMany({ where: { id: { in: parsed.ids } }, data });
    }
    if (agendar !== undefined) {
      const alvos = await prisma.client.findMany({
        where: { id: { in: parsed.ids } },
        select: { id: true, startedAt: true },
      });
      for (const c of alvos) {
        await prisma.client.update({
          where: { id: c.id },
          data: { expectedRenewalAt: agendar ? expectationInMonth(agendar, c.startedAt) : null },
        });
      }
    }
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar em massa.";
    return { ok: false, error: msg };
  }
}

/** Exclusão em massa (deleteMany é escopado por dono). */
export async function bulkDeleteClients(ids: string[]): Promise<ActionResult> {
  await requirePermission("clientes.excluir");
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
  if (!(await tryPermission("clientes.editar"))) return NO_PERMISSION;
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
  if (!(await tryPermission("clientes.editar"))) return NO_PERMISSION;
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

/**
 * Observações rápidas da linha (coluna Obs da carteira — o campo de
 * anotação livre da planilha). Grava direto em Client.notes; anotações
 * estruturadas continuam no dossiê (ClientNote).
 */
export async function setClientQuickNotes(
  clientId: string,
  notes: string
): Promise<ActionResult> {
  if (!(await tryPermission("clientes.editar"))) return NO_PERMISSION;
  try {
    const client = await prisma.client.findFirst({ where: { id: clientId } });
    if (!client) return { ok: false, error: "Cliente não encontrado." };
    const text = notes.trim().slice(0, 2000);
    await prisma.client.update({
      where: { id: clientId },
      data: { notes: text || null },
    });
    revalidateAgency({ clientId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao salvar a observação." };
  }
}
