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
  fillTemplate,
  type TemplateVariable,
} from "@/lib/docx/template";
import { getFile, putFile, removeFile, safeFileName } from "@/lib/storage";
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

    // Campos obrigatórios do modelo precisam estar preenchidos.
    const variables = (template.variables as unknown as TemplateVariable[]) ?? [];
    const missing = variables.filter(
      (v) => v.required && !(parsed.values[v.rawName] ?? "").trim()
    );
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Preencha os campos obrigatórios: ${missing.map((v) => v.label).join(", ")}.`,
      };
    }

    const original = await getFile(template.filePath);
    const filled = fillTemplate(original, parsed.values);

    const fileName = `${safeFileName(parsed.name) || "contrato"}.docx`;
    const generatedFilePath = `generated-contracts/${crypto.randomUUID()}/${fileName}`;
    await putFile(generatedFilePath, filled, DOCX_MIME);

    const created = await prisma.generatedContract.create({
      data: {
        templateId: template.id,
        clientId: parsed.clientId,
        name: parsed.name,
        commercialType: template.commercialType,
        amount: template.totalAmount ?? template.monthlyAmount,
        startDate: parsed.startDate,
        dueDay: parsed.dueDay ?? template.defaultDueDay,
        filledVariables: parsed.values as any,
        generatedFileName: fileName,
        generatedFilePath,
      },
    });
    revalidateAgency({ clientId: parsed.clientId });
    return { ok: true, id: created.id };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao gerar o contrato." };
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
