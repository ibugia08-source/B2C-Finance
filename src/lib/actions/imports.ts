"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/viewer";
import { readSheet, validateRows, type RowError } from "@/lib/imports/engine";
import { getImportDef, loadRefs } from "@/lib/imports/definitions";
import { formatCell } from "@/lib/reports/present";

/**
 * Importação em massa: mesma action valida (prévia) e confirma.
 * NADA é gravado sem confirm=1 — a prévia é 100% somente-leitura.
 * Linhas duplicadas (na planilha ou já no banco) são puladas, nunca
 * sobrescrevem registros existentes.
 */

const MAX_FILE = 3 * 1024 * 1024; // 3MB

export type ImportSummary = {
  ok: true;
  tipo: string;
  fileName: string;
  total: number;
  validas: number;
  comErro: number;
  duplicadas: number;
  headerErrors: string[];
  erros: RowError[]; // até 100
  preview: { headers: string[]; rows: string[][] }; // primeiras 10 válidas
  confirmed: { imported: number; batchId: string } | null;
};
export type ImportResult = ImportSummary | { ok: false; error: string };

export async function runImport(fd: FormData): Promise<ImportResult> {
  try {
    await requireAdmin();

    const tipo = String(fd.get("tipo") ?? "");
    const def = getImportDef(tipo);
    if (!def) return { ok: false, error: "Tipo de importação inválido." };

    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0)
      return { ok: false, error: "Selecione a planilha preenchida (.xlsx)." };
    if (file.size > MAX_FILE)
      return { ok: false, error: "Arquivo acima de 3MB." };
    const confirm = fd.get("confirm") === "1";

    const buffer = Buffer.from(await file.arrayBuffer());
    let raw: Record<string, unknown>[];
    try {
      raw = readSheet(buffer);
    } catch {
      return { ok: false, error: "Não foi possível ler o arquivo — envie um .xlsx válido." };
    }

    // 1. validação de tipos/obrigatórios
    const { rows, headerErrors } = validateRows(def.columns, raw);

    // 2. relacionamentos + regras de negócio + duplicidade
    const [refs, existing] = await Promise.all([loadRefs(), def.existingKeys()]);
    const seen = new Set<string>();
    const prepared: { linha: number; data: Record<string, unknown> }[] = [];
    let duplicadas = 0;

    for (const row of rows) {
      const err = (campo: string, erro: string) => row.errors.push({ linha: row.linha, campo, erro });
      const data = def.toData(row, refs, err);
      if (row.errors.length > 0 || !data) continue;
      const key = def.dupKey(data);
      if (existing.has(key) || seen.has(key)) {
        row.duplicate = true;
        duplicadas++;
        continue;
      }
      seen.add(key);
      prepared.push({ linha: row.linha, data });
    }

    const erros = rows.flatMap((r) => r.errors);
    const total = rows.length;
    const comErro = rows.filter((r) => r.errors.length > 0).length;
    const validas = prepared.length;

    // 3. prévia (primeiras 10 válidas, formatadas)
    const previewCols = def.columns.filter((c) => prepared.some((p) => p.data[c.key] != null));
    const kindMap = { text: "text", int: "int", money: "money", date: "date", enum: "text" } as const;
    const preview = {
      headers: previewCols.map((c) => c.header),
      rows: prepared.slice(0, 10).map((p) =>
        previewCols.map((c) => {
          const v = p.data[c.key];
          if (c.kind === "enum" && v != null) {
            return c.options?.find((o) => o.value === v)?.label ?? String(v);
          }
          return formatCell(v, kindMap[c.kind]) || "—";
        })
      ),
    };

    // 4. confirmação: cria em massa + registra o lote (auditoria)
    let confirmed: ImportSummary["confirmed"] = null;
    if (confirm) {
      if (validas === 0) return { ok: false, error: "Nenhuma linha válida para importar." };
      const imported = await def.create(prepared.map((p) => p.data), "");
      const batch = await prisma.importBatch.create({
        data: {
          source: "xlsx",
          module: def.key,
          fileName: file.name,
          total,
          imported,
          duplicates: duplicadas,
          errors: comErro,
        },
      });
      confirmed = { imported, batchId: batch.id };
      revalidatePath("/importacoes");
    }

    return {
      ok: true,
      tipo,
      fileName: file.name,
      total,
      validas,
      comErro,
      duplicadas,
      headerErrors,
      erros: erros.slice(0, 100),
      preview,
      confirmed,
    };
  } catch (e) {
    console.error("runImport", e);
    return { ok: false, error: "Falha ao processar a importação." };
  }
}
