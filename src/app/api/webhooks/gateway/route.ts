import { NextResponse } from "next/server";
import { receberEventoDoGateway } from "@/lib/integrations/gateway";

/**
 * WEBHOOK DE ENTRADA DO GATEWAY DE PAGAMENTO (F5.2 · ref. 03 §4.2, §4.3).
 *
 * Mesmo contrato da entrada do AvanceCRM: rota pública, autenticada pela
 * assinatura HMAC do corpo CRU, idempotente pela caixa de entrada, e 500
 * deliberado quando o processamento falha — o provedor reenvia e a unique
 * garante que o reenvio não duplica a baixa.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const corpo = await request.text();
  const assinatura =
    request.headers.get("x-b2c-signature") ?? request.headers.get("x-gateway-signature");

  try {
    const r = await receberEventoDoGateway(corpo, assinatura);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    return NextResponse.json({ recebido: true, situacao: r.situacao, nota: r.nota ?? null });
  } catch (e) {
    console.error("webhook gateway", e);
    return NextResponse.json({ error: "Falha ao processar o evento." }, { status: 500 });
  }
}
