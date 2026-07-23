import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/permissions";
import { getImportDef } from "@/lib/imports/definitions";

export const dynamic = "force-dynamic";

/**
 * Gera a planilha modelo do módulo (?tipo=clientes):
 * aba "Dados" com cabeçalhos + 2 linhas de exemplo, aba "Instruções"
 * com obrigatoriedade, formato e opções válidas de cada coluna.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "importacoes.visualizar")) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }
  const tipo = req.nextUrl.searchParams.get("tipo") ?? "";
  const def = getImportDef(tipo);
  if (!def) return NextResponse.json({ error: "Tipo inexistente" }, { status: 404 });

  const wb = XLSX.utils.book_new();

  // --- aba Dados: cabeçalho + exemplos (o usuário substitui os exemplos) ---
  const headers = def.columns.map((c) => c.header);
  const example = def.columns.map((c) => c.example ?? "");
  const dataSheet = XLSX.utils.aoa_to_sheet([headers, example]);
  dataSheet["!cols"] = def.columns.map((c) => ({ wch: Math.max(c.header.length + 2, 16) }));
  XLSX.utils.book_append_sheet(wb, dataSheet, "Dados");

  // --- aba Instruções ---
  const kindLabel: Record<string, string> = {
    text: "Texto",
    date: "Data (dd/mm/aaaa)",
    money: "Valor (1234,56)",
    int: "Número inteiro",
    enum: "Opção da lista",
  };
  const inst: (string | number)[][] = [
    [`Modelo de importação — ${def.title} (B2C Finance)`],
    [],
    ["COMO USAR"],
    ["1. Preencha a aba \"Dados\" a partir da linha 2 (substitua a linha de exemplo)."],
    ["2. Datas no formato dd/mm/aaaa. Valores no formato 1234,56 (sem R$)."],
    ["3. Não renomeie os cabeçalhos das colunas."],
    ["4. Máximo de 500 linhas por importação."],
    ...(def.instructions ?? []).map((i, idx) => [`${5 + idx}. ${i}`]),
    [],
    ["COLUNAS", "OBRIGATÓRIA", "FORMATO", "OPÇÕES VÁLIDAS", "OBSERVAÇÃO"],
    ...def.columns.map((c) => [
      c.header,
      c.required ? "SIM" : "não",
      kindLabel[c.kind],
      c.options ? c.options.map((o) => o.label).join(" | ") : "",
      c.description ?? "",
    ]),
  ];
  const instSheet = XLSX.utils.aoa_to_sheet(inst);
  instSheet["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 20 }, { wch: 50 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, instSheet, "Instruções");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="modelo-${def.key}.xlsx"`,
    },
  });
}
