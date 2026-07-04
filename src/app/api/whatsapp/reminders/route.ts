import { NextRequest, NextResponse } from "next/server";
import { getWhatsAppSettings } from "@/lib/whatsapp/provider";
import { sendReminders } from "@/lib/whatsapp/reminders";
import { runWithOwner } from "@/lib/auth/owner-scope";
import { getPrimaryAdminId } from "@/lib/auth/system-owner";

export const dynamic = "force-dynamic";

/**
 * Dispara os lembretes financeiros. Protegido por ?secret= (== remindersSecret).
 * Pensado para ser chamado por um agendador/cron no deploy.
 */
async function handle(req: NextRequest) {
  const settings = await getWhatsAppSettings();
  if (!settings) return NextResponse.json({ ok: false, error: "Não configurado." }, { status: 400 });

  const secret = new URL(req.url).searchParams.get("secret");
  if (!settings.remindersSecret || secret !== settings.remindersSecret) {
    return NextResponse.json({ ok: false, error: "Secret inválido." }, { status: 401 });
  }

  const adminId = await getPrimaryAdminId();
  const r = await runWithOwner(adminId, () => sendReminders());
  return NextResponse.json(r);
}

export const GET = handle;
export const POST = handle;
