import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/viewer";
import { dreParaCsv, montarDre } from "@/lib/services/dre";

/**
 * Exportação do DRE para o contador (F3.2 · 02 §4.5).
 *
 * CSV com ponto e vírgula e vírgula decimal: é o que o Excel em português
 * abre sem perguntar nada. A conversão decimal é feita número a número no
 * serviço — trocar todo ponto por vírgula no arquivo pronto transformaria o
 * código de conta "4.1" em "4,1".
 *
 * DECIDIDO 19.15: sem recorte por CNPJ nesta versão — a agência é
 * organizadora, não empresa, e exportar "por CNPJ" sem CNPJ seria inventar.
 */
export async function GET(req: Request) {
  await requirePermission("contabil.exportar");

  const url = new URL(req.url);
  const mes = url.searchParams.get("mes") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    return NextResponse.json({ error: "Informe o mês no formato AAAA-MM." }, { status: 400 });
  }

  const dre = await montarDre(mes, {
    base: url.searchParams.get("base") === "caixa" ? "caixa" : "competencia",
    agencyId: url.searchParams.get("agencia") || null,
    comProLabore: url.searchParams.get("prolabore") !== "fora",
  });

  const csv = dreParaCsv(dre);
  // BOM para o Excel reconhecer acentuação sem o usuário mexer em nada.
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dre-${mes}.csv"`,
    },
  });
}
