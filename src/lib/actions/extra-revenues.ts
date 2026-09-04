"use server";

import { requirePermission } from "@/lib/auth/viewer";
import { revalidateFinance } from "@/lib/revalidate";
import { parseBRL, parseDateBR } from "@/lib/format";
import {
  lancarReceitaExtra,
  excluirReceitaExtra,
} from "@/lib/services/extra-revenue";
import {
  EXTRA_REVENUE_MANUAL_TYPES,
  type ExtraRevenueManualType,
} from "@/lib/extra-revenue-meta";

/**
 * RECEITA EXTRA pela tela do mês (Gestão do Mês → Receitas Extras).
 *
 * A action só traduz o formulário e cobra a permissão; a regra (competência
 * obrigatória, trava de mês fechado, lançamento no razão, auditoria) mora no
 * serviço de domínio — o mesmo que os testes exercitam.
 */

export async function saveExtraRevenue(formData: FormData) {
  const viewer = await requirePermission("receitas.criar");
  try {
    const comp = String(formData.get("competence") || "");
    const [cy, cm] = comp.split("-").map(Number);
    const receivedAt =
      parseDateBR(String(formData.get("receivedAt") || "")) ?? new Date();
    const tipoBruto = String(formData.get("type") || "MANUAL_EXTRA_REVENUE");
    const type: ExtraRevenueManualType = (
      EXTRA_REVENUE_MANUAL_TYPES as readonly string[]
    ).includes(tipoBruto)
      ? (tipoBruto as ExtraRevenueManualType)
      : "MANUAL_EXTRA_REVENUE";

    const r = await lancarReceitaExtra({
      description: String(formData.get("description") || ""),
      amount: parseBRL(String(formData.get("amount") || "0")),
      competenceYear: cy || 0,
      competenceMonth: cm || 0,
      receivedAt,
      type,
      actorEmail: viewer.email,
    });
    if (r.ok) revalidateFinance();
    return r;
  } catch {
    return {
      ok: false as const,
      error: "Não consegui salvar. Confira o valor, a data e a competência.",
    };
  }
}

export async function deleteExtraRevenue(id: string) {
  const viewer = await requirePermission("receitas.excluir");
  const r = await excluirReceitaExtra(id, { actorEmail: viewer.email });
  if (r.ok) revalidateFinance();
  return r;
}
