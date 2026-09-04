"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, getViewer } from "@/lib/auth/viewer";
import { parsePlanilhaTotal, type ErroDeLinha } from "@/lib/imports/total/parser";
import {
  aplicarPlanilhaTotal, preverRevisoes,
  type ResultadoAplicacao, type RevisaoPrevista,
} from "@/lib/imports/total/aplicar";
import { reconciliarPorMes, type LinhaReconciliacao } from "@/lib/imports/total/reconciliar";
import { reverterLoteTotal, type ResultadoReversao } from "@/lib/imports/total/reverter";
import { gerarSnapshotsDeImportacao, type ResultadoSnapshots } from "@/lib/imports/total/snapshots";

/**
 * IMPORTAÇÃO TOTAL (F1.13 v2): mesma action valida (prévia) e confirma.
 * NADA é gravado sem confirm=1 — a prévia, incluindo o relatório de
 * reconciliação por mês e as revisões previstas, é 100% somente-leitura.
 */

const MAX_FILE = 8 * 1024 * 1024; // 8MB — planilha multi-mês é maior que a modular

export type PreviaTotal = {
  ok: true;
  fileName: string;
  formato: string;
  contagens: { clientes: number; mensal: number; renovacoes: number; competencias: number };
  erros: ErroDeLinha[];       // até 200
  avisos: string[];
  revisoes: RevisaoPrevista[]; // até 200
  reconciliacao: LinhaReconciliacao[];
  confirmado: (ResultadoAplicacao & { fotografias: ResultadoSnapshots }) | null;
};
export type ImportTotalResult = PreviaTotal | { ok: false; error: string };

export async function runImportTotal(fd: FormData): Promise<ImportTotalResult> {
  try {
    await requirePermission("importacoes.importar");
    const viewer = await getViewer();

    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0)
      return { ok: false, error: "Selecione a planilha preenchida (.xlsx)." };
    if (file.size > MAX_FILE) return { ok: false, error: "Arquivo acima de 8MB." };
    const confirm = fd.get("confirm") === "1";

    const buffer = Buffer.from(await file.arrayBuffer());
    const plan = parsePlanilhaTotal(buffer);

    const competencias = new Set(plan.mensal.map((m) => m.competencia));
    const base: Omit<PreviaTotal, "confirmado"> = {
      ok: true,
      fileName: file.name,
      formato: plan.formato,
      contagens: {
        clientes: plan.clientes.length,
        mensal: plan.mensal.length,
        renovacoes: plan.renovacoes.length,
        competencias: competencias.size,
      },
      erros: plan.erros.slice(0, 200),
      avisos: plan.avisos,
      revisoes: (await preverRevisoes(plan)).slice(0, 200),
      reconciliacao: reconciliarPorMes(plan),
    };

    if (!confirm) return { ...base, confirmado: null };

    if (plan.erros.length > 0)
      return {
        ok: false,
        error: `A planilha tem ${plan.erros.length} erro(s) de linha — corrija antes de confirmar.`,
      };
    if (plan.clientes.length + plan.mensal.length + plan.renovacoes.length === 0)
      return { ok: false, error: "A planilha não tem nenhuma linha para importar." };

    const resultado = await aplicarPlanilhaTotal(plan, {
      fileName: file.name,
      byEmail: viewer.email,
    });
    const fotografias = await gerarSnapshotsDeImportacao(resultado.competencias, resultado.batchId);

    revalidar();
    return { ...base, avisos: resultado.avisos, confirmado: { ...resultado, fotografias } };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha na importação." };
  }
}

export async function reverterImportTotalAction(batchId: string): Promise<ResultadoReversao> {
  await requirePermission("importacoes.importar");
  const r = await reverterLoteTotal(batchId);
  if (r.ok) revalidar();
  return r;
}

function revalidar() {
  for (const p of ["/importacoes", "/clientes", "/cobrancas", "/dashboard", "/avaliacoes", "/fechamento"])
    revalidatePath(p);
}
