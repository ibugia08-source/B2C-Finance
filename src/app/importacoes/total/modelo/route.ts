import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/viewer";
import { montarModeloXlsx } from "@/lib/imports/total/modelo";

export const dynamic = "force-dynamic";

export async function GET() {
  await requirePermission("importacoes.importar");
  const buf = montarModeloXlsx();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="importacao-total-modelo.xlsx"',
    },
  });
}
