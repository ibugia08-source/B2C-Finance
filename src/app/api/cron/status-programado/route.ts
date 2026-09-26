import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { materializarStatusProgramados } from "@/lib/clients/status-history";

/**
 * JOB DIÁRIO — ALTERAÇÕES DE STATUS PROGRAMADAS (26/09/2026).
 *
 * Status programado (ex.: Inativo a partir de 01/10) não mexe no status
 * atual antes da data. Quando a data chega, ESTE job materializa: roda a
 * transição (perda registrada, relação, cobranças futuras) e atualiza
 * Client.status. Nunca é feito durante a leitura de uma página.
 *
 * Agendado no vercel.json (00:10 no horário da Bahia). Idempotente: rodar
 * de novo não faz nada; atrasar só atrasa, não erra.
 *
 * Autenticação: com CRON_SECRET configurado, exige `Authorization: Bearer`
 * (é o que a Vercel envia). Sem ele, aceita só o agente do cron da Vercel —
 * o job não recebe parâmetro nenhum e só aplica o que já está registrado e
 * vencido, então disparar antes da hora não produz resultado diferente.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function autorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = Buffer.from(req.headers.get("authorization") ?? "");
    const want = Buffer.from(`Bearer ${secret}`);
    return got.length === want.length && timingSafeEqual(got, want);
  }
  return (req.headers.get("user-agent") ?? "").startsWith("vercel-cron/");
}

export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const r = await materializarStatusProgramados();
    if (r.atualizados > 0) {
      const { revalidateClientStatus } = await import("@/lib/revalidate");
      revalidateClientStatus();
    }
    if (r.falhas.length) console.error("[cron status-programado] falhas", r.falhas);
    return NextResponse.json(r);
  } catch (e) {
    console.error("[cron status-programado]", e);
    return NextResponse.json({ error: "Falha ao aplicar as alterações programadas." }, { status: 500 });
  }
}
