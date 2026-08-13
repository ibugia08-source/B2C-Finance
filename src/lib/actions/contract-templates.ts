"use server";
import { prisma } from "@/lib/prisma";
import { revalidateAgency } from "@/lib/revalidate";
import { z } from "zod";
import crypto from "crypto";
import {
  BillingModel,
  ContractCommercialType,
  ContractDurationType,
  ContractTemplateStatus,
  ClientDocumentType,
  GeneratedContractStatus,
} from "@prisma/client";
import { requirePermission } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, clean } from "@/lib/format";
import {
  extractTemplateVariables,
  type TemplateVariable,
} from "@/lib/docx/template";
import { putFile, removeFile, safeFileName } from "@/lib/storage";
import type { ActionResult } from "./clients";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_UPLOAD_MB = Number(process.env.B2C_MAX_UPLOAD_MB ?? 10);


async function readUpload(
  file: unknown,
  opts: { docxOnly?: boolean } = {}
): Promise<{ buffer: Buffer; name: string; type: string; size: number }> {
  if (!file || typeof file === "string" || !(file instanceof File) || file.size === 0) {
    throw new Error("Selecione um arquivo.");
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`Arquivo acima de ${MAX_UPLOAD_MB} MB — envie um arquivo menor.`);
  }
  if (opts.docxOnly && !file.name.toLowerCase().endsWith(".docx")) {
    throw new Error("Envie o modelo em formato .docx (Word).");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return { buffer, name: file.name, type: file.type || DOCX_MIME, size: file.size };
}

const VariableSchema = z.object({
  originalToken: z.string().min(1),
  rawName: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "date", "number", "money", "email", "phone", "document"]),
  required: z.boolean(),
  clientField: z.string().nullable(),
});

// ---------- Análise (prévia antes de salvar) ----------

export type TemplateInspection =
  | { ok: true; variables: TemplateVariable[]; warnings: string[] }
  | { ok: false; error: string };

/** Lê o DOCX enviado e devolve variáveis + alertas, sem persistir nada. */
export async function inspectContractTemplateFile(
  formData: FormData
): Promise<TemplateInspection> {
  await requirePermission("contratos.editar");
  try {
    const { buffer } = await readUpload(formData.get("file"), { docxOnly: true });
    const { variables, warnings } = extractTemplateVariables(buffer);
    if (variables.length === 0) {
      warnings.push(
        "Nenhuma variável foi identificada neste modelo. Confira se o documento utiliza variáveis no formato {{Nome da variável}}."
      );
    }
    return { ok: true, variables, warnings };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Não foi possível ler o modelo." };
  }
}

// ---------- Análise de metadados com IA (pré-preenche o cadastro) ----------

export type TemplateMetaExtraction =
  | {
      ok: true;
      data: {
        commercialType: string | null;
        billingModel: string | null;
        durationType: string | null;
        durationMonths: number | null;
        monthlyAmount: number | null;
        totalAmount: number | null;
        defaultDueDay: number | null;
        includedServices: string[];
      };
    }
  | { ok: false; error: string };

/**
 * Lê o TEXTO do modelo DOCX e usa a IA configurada para sugerir os metadados
 * comerciais (tipo, prazo, valores, serviços) — o usuário confere antes de
 * salvar; nada é gravado aqui.
 */
export async function extractTemplateMeta(formData: FormData): Promise<TemplateMetaExtraction> {
  await requirePermission("contratos.editar");
  try {
    const { buffer } = await readUpload(formData.get("file"), { docxOnly: true });
    const { getDocxText } = await import("@/lib/docx/template");
    const text = getDocxText(buffer);
    if (text.length < 100) {
      return { ok: false, error: "O modelo tem pouco texto para análise automática." };
    }

    const { getAISettings, isConfigured, chatComplete } = await import("@/lib/ai/provider");
    const settings = await getAISettings();
    if (!isConfigured(settings)) {
      return {
        ok: false,
        error: "IA não configurada — preencha manualmente ou configure o Assistente IA.",
      };
    }

    const system = `Você extrai metadados comerciais de um MODELO de contrato de uma agência de marketing (B2C Gestão). O texto contém variáveis {{assim}} que serão preenchidas depois — ignore-as como valores.
Responda APENAS um JSON válido com estes campos (null quando o contrato não disser):
{"commercialType":"MRR|TCV|ONE_TIME|CUSTOM|null","billingModel":"MONTHLY|UPFRONT|INSTALLMENTS|CUSTOM|null","durationType":"MONTHLY|QUARTERLY|SEMIANNUAL|ANNUAL|CUSTOM|null","durationMonths":number|null,"monthlyAmount":number|null,"totalAmount":number|null,"defaultDueDay":number|null,"includedServices":["..."]}
Regras: MRR = recorrência mensal sem prazo de pagamento único; TCV = valor total fechado do contrato. durationMonths em meses (trimestral=3, semestral=6, anual=12). Valores em número (1200.50), sem R$. includedServices = serviços/entregas listados no objeto do contrato (curtos, ex.: "Tráfego pago"). defaultDueDay entre 1 e 28. Nunca invente valores que não estão no texto.`;

    const result = await chatComplete({
      settings,
      system,
      messages: [{ role: "user", content: `MODELO DE CONTRATO:\n${text.slice(0, 14000)}` }],
      maxTokens: 400,
    });

    const raw = result.text.replace(/```json|```/g, "").trim();
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));

    const num = (v: unknown): number | null =>
      typeof v === "number" && isFinite(v) && v > 0 ? v : null;
    const oneOf = <T extends string>(v: unknown, opts: readonly T[]): T | null =>
      typeof v === "string" && (opts as readonly string[]).includes(v) ? (v as T) : null;

    return {
      ok: true,
      data: {
        commercialType: oneOf(json.commercialType, ["MRR", "TCV", "ONE_TIME", "CUSTOM"]),
        billingModel: oneOf(json.billingModel, ["MONTHLY", "UPFRONT", "INSTALLMENTS", "CUSTOM"]),
        durationType: oneOf(json.durationType, ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "CUSTOM"]),
        durationMonths: num(json.durationMonths),
        monthlyAmount: num(json.monthlyAmount),
        totalAmount: num(json.totalAmount),
        defaultDueDay:
          num(json.defaultDueDay) != null && Number(json.defaultDueDay) <= 28
            ? Math.trunc(Number(json.defaultDueDay))
            : null,
        includedServices: Array.isArray(json.includedServices)
          ? json.includedServices.filter((s: unknown) => typeof s === "string").slice(0, 12)
          : [],
      },
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message ?? "Não foi possível analisar o modelo com IA — preencha manualmente.",
    };
  }
}

// ---------- Cadastro / edição de modelos ----------

const TemplateMetaSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do modelo."),
  description: z.string().trim().nullable(),
  commercialType: z.nativeEnum(ContractCommercialType).nullable(),
  billingModel: z.nativeEnum(BillingModel).nullable(),
  durationType: z.nativeEnum(ContractDurationType).nullable(),
  durationMonths: z.number().int().min(1).max(120).nullable(),
  monthlyAmount: z.number().nonnegative().nullable(),
  totalAmount: z.number().nonnegative().nullable(),
  defaultDueDay: z.number().int().min(1).max(28).nullable(),
  includedServices: z.array(z.string().trim().min(1)),
  internalNotes: z.string().trim().nullable(),
  status: z.nativeEnum(ContractTemplateStatus),
});

function parseTemplateMeta(formData: FormData) {
  return TemplateMetaSchema.parse({
    name: String(formData.get("name") ?? "").trim(),
    description: clean(formData.get("description")),
    commercialType: (clean(formData.get("commercialType")) as ContractCommercialType) ?? null,
    billingModel: (clean(formData.get("billingModel")) as BillingModel) ?? null,
    durationType: (clean(formData.get("durationType")) as ContractDurationType) ?? null,
    durationMonths: clean(formData.get("durationMonths"))
      ? parseInt(String(formData.get("durationMonths")), 10)
      : null,
    monthlyAmount: clean(formData.get("monthlyAmount"))
      ? parseBRL(String(formData.get("monthlyAmount")))
      : null,
    totalAmount: clean(formData.get("totalAmount"))
      ? parseBRL(String(formData.get("totalAmount")))
      : null,
    defaultDueDay: clean(formData.get("defaultDueDay"))
      ? parseInt(String(formData.get("defaultDueDay")), 10)
      : null,
    includedServices: (clean(formData.get("includedServices")) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    internalNotes: clean(formData.get("internalNotes")),
    status: (clean(formData.get("status")) as ContractTemplateStatus) ?? "ACTIVE",
  });
}

/** Cadastra o modelo: guarda o DOCX no storage e as variáveis no banco. */
export async function createContractTemplate(formData: FormData): Promise<ActionResult> {
  await requirePermission("contratos.editar");
  try {
    const upload = await readUpload(formData.get("file"), { docxOnly: true });
    const meta = parseTemplateMeta(formData);
    const { variables, warnings } = extractTemplateVariables(upload.buffer);

    const filePath = `contract-templates/${crypto.randomUUID()}/${safeFileName(upload.name)}`;
    await putFile(filePath, upload.buffer, DOCX_MIME);

    const created = await prisma.contractTemplate.create({
      data: {
        name: meta.name,
        description: meta.description,
        commercialType: meta.commercialType,
        billingModel: meta.billingModel,
        durationType: meta.durationType,
        durationMonths: meta.durationMonths,
        monthlyAmount: meta.monthlyAmount,
        totalAmount: meta.totalAmount,
        defaultDueDay: meta.defaultDueDay,
        includedServices: meta.includedServices,
        internalNotes: meta.internalNotes,
        status: meta.status,
        originalFileName: upload.name,
        filePath,
        mimeType: DOCX_MIME,
        fileSize: upload.size,
        fileHash: crypto.createHash("sha256").update(upload.buffer).digest("hex"),
        variables: variables as any,
        warnings: warnings as any,
      },
    });
    revalidateAgency();
    return { ok: true, id: created.id };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o modelo." };
  }
}

/** Edita nome/descrição/metadados/status (o arquivo original não muda). */
export async function updateContractTemplate(formData: FormData): Promise<ActionResult> {
  await requirePermission("contratos.editar");
  try {
    const id = String(formData.get("id") ?? "");
    const existing = await prisma.contractTemplate.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Modelo não encontrado." };
    const meta = parseTemplateMeta(formData);
    await prisma.contractTemplate.update({ where: { id }, data: { ...meta } });
    revalidateAgency({ contractId: id });
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar o modelo." };
  }
}

/** Atualiza o mapeamento das variáveis (label, obrigatório, campo do cliente). */
export async function updateTemplateVariables(formData: FormData): Promise<ActionResult> {
  await requirePermission("contratos.editar");
  try {
    const id = String(formData.get("id") ?? "");
    const existing = await prisma.contractTemplate.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Modelo não encontrado." };

    const incoming = z.array(VariableSchema).parse(JSON.parse(String(formData.get("variables") ?? "[]")));
    const current = (existing.variables as unknown as TemplateVariable[]) ?? [];
    // Só ajustes de mapeamento: os tokens precisam continuar os do arquivo.
    const known = new Set(current.map((v) => v.rawName));
    if (incoming.length !== current.length || incoming.some((v) => !known.has(v.rawName))) {
      return { ok: false, error: "As variáveis não conferem com o arquivo do modelo." };
    }
    await prisma.contractTemplate.update({
      where: { id },
      data: { variables: incoming as any },
    });
    revalidateAgency({ contractId: id });
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar as variáveis." };
  }
}

export async function setContractTemplateStatus(
  id: string,
  status: ContractTemplateStatus
): Promise<ActionResult> {
  await requirePermission("contratos.editar");
  try {
    const existing = await prisma.contractTemplate.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Modelo não encontrado." };
    await prisma.contractTemplate.update({ where: { id }, data: { status } });
    revalidateAgency({ contractId: id });
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao alterar o status." };
  }
}

/** Exclui o modelo (apenas sem contratos gerados — senão, arquive). */
export async function deleteContractTemplate(id: string): Promise<ActionResult> {
  await requirePermission("contratos.excluir");
  try {
    const existing = await prisma.contractTemplate.findUnique({
      where: { id },
      include: { _count: { select: { generated: true } } },
    });
    if (!existing) return { ok: false, error: "Modelo não encontrado." };
    if (existing._count.generated > 0) {
      return {
        ok: false,
        error: "Este modelo já gerou contratos — arquive-o em vez de excluir para manter o histórico.",
      };
    }
    await prisma.contractTemplate.delete({ where: { id } });
    await removeFile(existing.filePath);
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o modelo." };
  }
}

// ---------- Geração de contrato ----------

const GenerateSchema = z.object({
  templateId: z.string().min(1, "Selecione o modelo."),
  clientId: z.string().nullable(),
  name: z.string().trim().min(1, "Informe o nome do contrato gerado."),
  startDate: z.date().nullable(),
  dueDay: z.number().int().min(1).max(28).nullable(),
  values: z.record(z.string()),
});

/** Preenche o modelo e salva o contrato gerado (DOCX novo; o modelo fica intacto). */
export async function generateContractFromTemplate(formData: FormData): Promise<ActionResult> {
  await requirePermission("contratos.gerar_contrato");
  try {
    const parsed = GenerateSchema.parse({
      templateId: String(formData.get("templateId") ?? ""),
      clientId: clean(formData.get("clientId")),
      name: String(formData.get("name") ?? "").trim(),
      startDate: clean(formData.get("startDate"))
        ? parseDateBR(String(formData.get("startDate")))
        : null,
      dueDay: clean(formData.get("dueDay"))
        ? parseInt(String(formData.get("dueDay")), 10)
        : null,
      values: JSON.parse(String(formData.get("values") ?? "{}")),
    });

    const template = await prisma.contractTemplate.findUnique({
      where: { id: parsed.templateId },
    });
    if (!template) return { ok: false, error: "Modelo não encontrado." };

    if (parsed.clientId) {
      const owned = await prisma.client.findUnique({ where: { id: parsed.clientId } });
      if (!owned) return { ok: false, error: "Cliente não encontrado." };
    }

    // Núcleo compartilhado com o formulário público (valida obrigatórios,
    // preenche o DOCX e cria o registro).
    const { generateContractCore } = await import("@/lib/services/contract-generation");
    const result = await generateContractCore({
      template,
      values: parsed.values,
      name: parsed.name,
      clientId: parsed.clientId,
      startDate: parsed.startDate,
      dueDay: parsed.dueDay,
    });
    if (!result.ok) return result;

    revalidateAgency({ clientId: parsed.clientId });
    return { ok: true, id: result.id };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao gerar o contrato." };
  }
}

// ---------- Link público de formulário (/f/{token}) ----------

/**
 * Cria um link público de formulário para o modelo — geral ou direcionado a
 * um cliente (pré-preenche o cadastro dele). O token é opaco (não listável);
 * quem tem o link responde as perguntas e o contrato é gerado na plataforma.
 */
export async function createFormLink(
  templateId: string,
  clientId?: string | null
): Promise<ActionResult & { url?: string }> {
  const viewer = await requirePermission("contratos.gerar_contrato");
  try {
    const template = await prisma.contractTemplate.findUnique({ where: { id: templateId } });
    if (!template) return { ok: false, error: "Modelo não encontrado." };
    if (template.status !== "ACTIVE") {
      return { ok: false, error: "Ative o modelo antes de criar um link de formulário." };
    }
    if (clientId) {
      const owned = await prisma.client.findUnique({ where: { id: clientId } });
      if (!owned) return { ok: false, error: "Cliente não encontrado." };
    }

    const { generateSecret } = await import("@/lib/auth/session");
    const token = generateSecret(24);
    const link = await prisma.contractFormLink.create({
      data: {
        token,
        templateId,
        clientId: clientId ?? null,
        // Dono explícito (modelo global): o formulário roda no workspace do
        // criador do link.
        ownerId: viewer.workspaceOwnerId ?? viewer.id,
      },
    });
    revalidateAgency({ contractId: templateId });
    return { ok: true, id: link.id, url: `/f/${token}` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao criar o link." };
  }
}

/** Ativa/desativa um link público (desativado → página indisponível). */
export async function setFormLinkActive(id: string, active: boolean): Promise<ActionResult> {
  const viewer = await requirePermission("contratos.gerar_contrato");
  try {
    const link = await prisma.contractFormLink.findUnique({ where: { id } });
    // Modelo global → checagem explícita de dono (a extensão não cobre).
    const root = viewer.workspaceOwnerId ?? viewer.id;
    if (!link || link.ownerId !== root) return { ok: false, error: "Link não encontrado." };
    await prisma.contractFormLink.update({ where: { id }, data: { active } });
    revalidateAgency({ contractId: link.templateId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao alterar o link." };
  }
}

export async function setGeneratedContractStatus(
  id: string,
  status: GeneratedContractStatus
): Promise<ActionResult> {
  await requirePermission("contratos.editar");
  try {
    const existing = await prisma.generatedContract.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Contrato não encontrado." };
    await prisma.generatedContract.update({ where: { id }, data: { status } });
    revalidateAgency({ clientId: existing.clientId });
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao alterar o status." };
  }
}

export async function deleteGeneratedContract(id: string): Promise<ActionResult> {
  await requirePermission("contratos.excluir");
  try {
    const existing = await prisma.generatedContract.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Contrato não encontrado." };
    await prisma.generatedContract.delete({ where: { id } });
    await removeFile(existing.generatedFilePath);
    revalidateAgency({ clientId: existing.clientId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o contrato gerado." };
  }
}

// ---------- Documentos do cliente ----------

const DOCUMENT_MIMES = new Set([
  DOCX_MIME,
  "application/pdf",
  "application/msword",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
]);

export async function saveClientDocument(formData: FormData): Promise<ActionResult> {
  await requirePermission("clientes.anexar_documentos");
  try {
    const clientId = String(formData.get("clientId") ?? "");
    const owned = await prisma.client.findUnique({ where: { id: clientId } });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    const upload = await readUpload(formData.get("file"));
    if (!DOCUMENT_MIMES.has(upload.type)) {
      return { ok: false, error: "Tipo de arquivo não suportado (use PDF, Word, imagem, planilha ou texto)." };
    }
    const name = clean(formData.get("name")) ?? upload.name;
    const documentType =
      (clean(formData.get("documentType")) as ClientDocumentType) ?? "OTHER";

    const filePath = `client-documents/${clientId}/${crypto.randomUUID()}/${safeFileName(upload.name)}`;
    await putFile(filePath, upload.buffer, upload.type);

    await prisma.clientDocument.create({
      data: {
        clientId,
        name,
        description: clean(formData.get("description")),
        documentType,
        fileName: upload.name,
        filePath,
        mimeType: upload.type,
        size: upload.size,
      },
    });
    revalidateAgency({ clientId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao anexar o documento." };
  }
}

export async function deleteClientDocument(id: string): Promise<ActionResult> {
  await requirePermission("clientes.anexar_documentos");
  try {
    const existing = await prisma.clientDocument.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Documento não encontrado." };
    await prisma.clientDocument.delete({ where: { id } });
    await removeFile(existing.filePath);
    revalidateAgency({ clientId: existing.clientId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o documento." };
  }
}

// ---------- Contexto do cliente (observações internas) ----------

const NoteSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1),
  title: z.string().trim().min(1, "Informe o título."),
  content: z.string().trim().min(1, "Escreva o conteúdo."),
  type: z.string().nullable(),
});

export async function saveClientNote(formData: FormData): Promise<ActionResult> {
  await requirePermission("clientes.editar");
  try {
    const parsed = NoteSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      clientId: String(formData.get("clientId") ?? ""),
      title: String(formData.get("title") ?? "").trim(),
      content: String(formData.get("content") ?? "").trim(),
      type: clean(formData.get("type")),
    });
    const owned = await prisma.client.findUnique({ where: { id: parsed.clientId } });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    if (parsed.id) {
      const existing = await prisma.clientNote.findUnique({ where: { id: parsed.id } });
      if (!existing) return { ok: false, error: "Observação não encontrada." };
      await prisma.clientNote.update({
        where: { id: parsed.id },
        data: { title: parsed.title, content: parsed.content, type: parsed.type },
      });
    } else {
      await prisma.clientNote.create({
        data: {
          clientId: parsed.clientId,
          title: parsed.title,
          content: parsed.content,
          type: parsed.type,
        },
      });
    }
    revalidateAgency({ clientId: parsed.clientId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar a observação." };
  }
}

export async function deleteClientNote(id: string): Promise<ActionResult> {
  await requirePermission("clientes.editar");
  try {
    const existing = await prisma.clientNote.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Observação não encontrada." };
    await prisma.clientNote.delete({ where: { id } });
    revalidateAgency({ clientId: existing.clientId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir a observação." };
  }
}
