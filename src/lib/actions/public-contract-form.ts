"use server";
import { prisma } from "@/lib/prisma";
import { runWithOwner } from "@/lib/auth/owner-scope";
import { revalidateAgency } from "@/lib/revalidate";
import { generateContractCore } from "@/lib/services/contract-generation";
import type { TemplateVariable } from "@/lib/docx/template";

/**
 * ÚNICA server action PÚBLICA do sistema (sem getViewer, de propósito):
 * recebe a resposta do formulário /f/{token} e gera o contrato.
 *
 * Segurança em camadas:
 *  - o token é opaco/inadivinhável e revalidado aqui (ativo + modelo ativo);
 *  - o dono vem do PRÓPRIO link (runWithOwner) — nunca de input do usuário;
 *  - só valores de variáveis CONHECIDAS do modelo entram (com limite de
 *    tamanho) — nada além disso é gravado;
 *  - POSTs em /f/ passam pelo rate limit de IP do middleware;
 *  - quem responde NÃO recebe o arquivo — o contrato fica para revisão da
 *    equipe em /contratos.
 */
export async function submitPublicContractForm(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const token = String(formData.get("token") ?? "");
    if (!token || token.length > 128) return { ok: false, error: "Link inválido." };

    let raw: unknown;
    try {
      raw = JSON.parse(String(formData.get("values") ?? "{}"));
    } catch {
      return { ok: false, error: "Não foi possível ler as respostas — tente novamente." };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: "Não foi possível ler as respostas — tente novamente." };
    }

    const link = await prisma.contractFormLink.findUnique({ where: { token } });
    if (!link || !link.active) {
      return { ok: false, error: "Este link não está mais disponível. Fale com a equipe B2C." };
    }

    return await runWithOwner(link.ownerId, async () => {
      const template = await prisma.contractTemplate.findUnique({
        where: { id: link.templateId },
      });
      if (!template || template.status !== "ACTIVE") {
        return {
          ok: false as const,
          error: "Este link não está mais disponível. Fale com a equipe B2C.",
        };
      }

      // Só variáveis que existem no modelo, com limite de tamanho.
      const variables = (template.variables as unknown as TemplateVariable[]) ?? [];
      const known = new Set(variables.map((v) => v.rawName));
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (known.has(k) && typeof v === "string") values[k] = v.slice(0, 500);
      }

      // Nome do contrato: quem respondeu (variável mapeada ao nome) ou a data.
      const nameVar = variables.find((v) => v.clientField === "client.name");
      const respondent = nameVar ? (values[nameVar.rawName] ?? "").trim() : "";
      const name = `${template.name} — ${
        respondent || `formulário ${new Date().toLocaleDateString("pt-BR")}`
      }`;

      const result = await generateContractCore({
        template,
        values,
        name,
        clientId: link.clientId,
        formLinkId: link.id,
      });
      if (!result.ok) return result;

      await prisma.contractFormLink.update({
        where: { id: link.id },
        data: { submissions: { increment: 1 } },
      });
      revalidateAgency({ clientId: link.clientId ?? undefined });
      return { ok: true as const };
    });
  } catch {
    // Nunca vazar detalhes internos para o formulário público.
    return { ok: false, error: "Algo deu errado ao gerar o contrato. Tente novamente." };
  }
}
