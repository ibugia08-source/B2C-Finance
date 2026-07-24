import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { fillTemplate, type TemplateVariable } from "@/lib/docx/template";
import { getFile, putFile, safeFileName } from "@/lib/storage";
import type { ContractTemplate } from "@prisma/client";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type GenerateContractInput = {
  template: ContractTemplate;
  /** Valores indexados por rawName (chave exata do {{token}}). */
  values: Record<string, string>;
  name: string;
  clientId?: string | null;
  startDate?: Date | null;
  dueDay?: number | null;
  /** Preenchido quando a origem é o formulário público (/f/{token}). */
  formLinkId?: string | null;
};

/**
 * Núcleo da geração de contrato — usado pelo wizard interno
 * (generateContractFromTemplate) e pelo formulário público. Valida os campos
 * obrigatórios do modelo, preenche o DOCX (docxtemplater, formatação
 * preservada), grava o arquivo novo no storage e cria o GeneratedContract.
 * O ownerId é injetado pela extensão do Prisma (sessão ou runWithOwner).
 */
export async function generateContractCore(
  input: GenerateContractInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const variables = (input.template.variables as unknown as TemplateVariable[]) ?? [];
  const missing = variables.filter(
    (v) => v.required && !(input.values[v.rawName] ?? "").trim()
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Preencha os campos obrigatórios: ${missing.map((v) => v.label).join(", ")}.`,
    };
  }

  const original = await getFile(input.template.filePath);
  const filled = fillTemplate(original, input.values);

  const fileName = `${safeFileName(input.name) || "contrato"}.docx`;
  const generatedFilePath = `generated-contracts/${crypto.randomUUID()}/${fileName}`;
  await putFile(generatedFilePath, filled, DOCX_MIME);

  const created = await prisma.generatedContract.create({
    data: {
      templateId: input.template.id,
      clientId: input.clientId ?? null,
      name: input.name,
      commercialType: input.template.commercialType,
      amount: input.template.totalAmount ?? input.template.monthlyAmount,
      startDate: input.startDate ?? null,
      dueDay: input.dueDay ?? input.template.defaultDueDay,
      filledVariables: input.values as any,
      generatedFileName: fileName,
      generatedFilePath,
      formLinkId: input.formLinkId ?? null,
    },
  });
  return { ok: true, id: created.id };
}
