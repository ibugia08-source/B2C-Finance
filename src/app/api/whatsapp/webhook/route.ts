import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWhatsAppSettings, isAllowedSender, sendText } from "@/lib/whatsapp/provider";
import { parseIncoming } from "@/lib/whatsapp/parse";
import { runAgent } from "@/lib/whatsapp/agent";
import { runWithOwner } from "@/lib/auth/owner-scope";
import { getPrimaryAdminId } from "@/lib/auth/system-owner";

export const dynamic = "force-dynamic";

// Healthcheck / verificação do gateway
export async function GET() {
  return NextResponse.json({ ok: true, service: "b2c-whatsapp-webhook" });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: "invalid_json" });
  }

  const settings = await getWhatsAppSettings();
  if (!settings || !settings.enabled) {
    return NextResponse.json({ ok: true, ignored: "disabled" });
  }

  const msg = parseIncoming(body);

  // ignora mensagens próprias e remetentes não autorizados
  if (msg.fromMe) return NextResponse.json({ ok: true, ignored: "from_me" });
  if (!isAllowedSender(msg.from, settings)) {
    return NextResponse.json({ ok: true, ignored: "sender_not_allowed" });
  }
  if (!msg.text && !msg.imageUrl) {
    // tipo não suportado (ex.: áudio na v1)
    await sendText(
      msg.from!,
      "Por enquanto eu entendo *texto* e *foto* (comprovantes). Áudio chega na próxima versão. 🙂"
    );
    return NextResponse.json({ ok: true, ignored: "unsupported_type" });
  }

  // log de entrada
  await prisma.whatsAppMessage.create({
    data: {
      direction: "in",
      waType: msg.waType,
      fromNumber: msg.from ?? null,
      body: msg.text ?? null,
      mediaUrl: msg.imageUrl ?? null,
    },
  });

  // agente decide e executa (age sobre os dados do admin primário)
  const adminId = await getPrimaryAdminId();
  const result = await runWithOwner(adminId, () =>
    runAgent({ text: msg.text, imageUrl: msg.imageUrl, from: msg.from })
  );

  // responde no WhatsApp
  await sendText(msg.from!, result.reply);

  // log de saída
  await prisma.whatsAppMessage.create({
    data: {
      direction: "out",
      waType: "text",
      fromNumber: msg.from ?? null,
      body: result.reply,
      intent: result.action,
      actionTaken: result.created ? JSON.stringify(result.created) : null,
      status: result.error ? "error" : "ok",
      error: result.error ?? null,
    },
  });

  return NextResponse.json({ ok: true, action: result.action });
}
