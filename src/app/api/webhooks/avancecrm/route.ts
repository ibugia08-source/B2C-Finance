import { NextResponse } from "next/server";
import { receberEvento } from "@/lib/integrations/avancecrm";

/**
 * WEBHOOK DE ENTRADA DO AVANCECRM (F4.8 · ref. 03 §4.2; cenário S20).
 *
 * A rota é PÚBLICA por natureza — provedor de webhook não faz login. Quem
 * autentica é a ASSINATURA HMAC do corpo, conferida em tempo constante.
 *
 * O corpo é lido CRU (`request.text()`) e só depois parseado: a assinatura é
 * do texto que chegou. Ler como JSON e reserializar muda espaços e ordem de
 * chaves, e a assinatura deixa de bater por um motivo que ninguém acha.
 *
 * EVENTO REPETIDO RESPONDE 200. Todo provedor reenvia quando não recebe 200 a
 * tempo, e isso é o comportamento correto dele; devolver erro para o repetido
 * faria o reenvio virar loop.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const corpo = await request.text();
  const assinatura =
    request.headers.get("x-b2c-signature") ??
    request.headers.get("x-avancecrm-signature");

  try {
    const r = await receberEvento(corpo, assinatura);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    return NextResponse.json({ recebido: true, situacao: r.situacao, nota: r.nota ?? null });
  } catch (e) {
    console.error("webhook avancecrm", e);
    // 500 aqui é DELIBERADO: o provedor reenvia, e a unique da caixa de
    // entrada garante que o reenvio não duplica o fato.
    return NextResponse.json({ error: "Falha ao processar o evento." }, { status: 500 });
  }
}
