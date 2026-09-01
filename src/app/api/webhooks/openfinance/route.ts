import { NextResponse } from "next/server";
import { receberEventoDoOpenFinance } from "@/lib/integrations/openfinance";

/**
 * WEBHOOK DE ENTRADA DO OPEN FINANCE (F5.3 · ref. 03 §4.2, §4.3).
 *
 * Mesmo contrato das outras entradas: rota pública autenticada pela
 * assinatura HMAC do corpo CRU, idempotente pela caixa de entrada, e 500
 * deliberado na falha — o agregador reenvia e a unique impede a duplicata.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const corpo = await request.text();
  const assinatura =
    request.headers.get("x-b2c-signature") ?? request.headers.get("x-openfinance-signature");

  try {
    const r = await receberEventoDoOpenFinance(corpo, assinatura);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    return NextResponse.json({ recebido: true, situacao: r.situacao, nota: r.nota ?? null });
  } catch (e) {
    console.error("webhook openfinance", e);
    return NextResponse.json({ error: "Falha ao processar o evento." }, { status: 500 });
  }
}
