"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/viewer";
import { getWhatsAppSettings, isWhatsAppReady, sendText } from "@/lib/whatsapp/provider";
import { runAgent, type AgentResult } from "@/lib/whatsapp/agent";
import { sendReminders } from "@/lib/whatsapp/reminders";

const SINGLETON_ID = "default";

export type WhatsAppSettingsView = {
  provider: string;
  baseUrl: string;
  instanceId: string;
  myNumber: string;
  remindersSecret: string;
  enabled: boolean;
  hasToken: boolean;
  hasClientToken: boolean;
};

export async function getWhatsAppSettingsView(): Promise<WhatsAppSettingsView> {
  await requireAdmin();
  const s = await prisma.whatsAppSetting.findUnique({ where: { id: SINGLETON_ID } });
  return {
    provider: s?.provider ?? "zapi",
    baseUrl: s?.baseUrl ?? "",
    instanceId: s?.instanceId ?? "",
    myNumber: s?.myNumber ?? "",
    remindersSecret: s?.remindersSecret ?? "",
    enabled: s?.enabled ?? false,
    hasToken: !!s?.token,
    hasClientToken: !!s?.clientToken,
  };
}

export async function saveWhatsAppSettings(formData: FormData) {
  await requireAdmin();
  const provider = String(formData.get("provider") || "zapi");
  const baseUrl = String(formData.get("baseUrl") || "").trim() || null;
  const instanceId = String(formData.get("instanceId") || "").trim() || null;
  const myNumber = String(formData.get("myNumber") || "").trim() || null;
  const remindersSecret = String(formData.get("remindersSecret") || "").trim() || null;
  const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
  const tokenRaw = String(formData.get("token") || "");
  const clientTokenRaw = String(formData.get("clientToken") || "");

  const data: any = { provider, baseUrl, instanceId, myNumber, remindersSecret, enabled };
  if (tokenRaw && !tokenRaw.startsWith("•")) data.token = tokenRaw.trim() || null;
  if (clientTokenRaw && !clientTokenRaw.startsWith("•")) data.clientToken = clientTokenRaw.trim() || null;

  await prisma.whatsAppSetting.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
  revalidatePath("/whatsapp");
}

export async function testWhatsAppSend(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const s = await getWhatsAppSettings();
  if (!isWhatsAppReady(s)) return { ok: false, message: "Configure URL, número e ative o WhatsApp antes." };
  const r = await sendText(
    s.myNumber!,
    "✅ B2C Finance conectado! Este é um teste do seu agente financeiro no WhatsApp."
  );
  return r.ok
    ? { ok: true, message: "Mensagem de teste enviada para o seu número." }
    : { ok: false, message: r.error ?? "Falha ao enviar." };
}

/** Simulador: roda o agente como se fosse uma mensagem do WhatsApp (sem enviar nada). */
export async function simulateMessage(text: string): Promise<AgentResult> {
  await requireAdmin();
  const t = text.trim();
  if (!t) return { reply: "Escreva uma mensagem.", action: "smalltalk" };
  const result = await runAgent({ text: t });
  await prisma.whatsAppMessage.create({
    data: {
      direction: "in",
      waType: "text",
      fromNumber: "simulador",
      body: t,
      intent: result.action,
      actionTaken: result.created ? JSON.stringify(result.created) : null,
      status: result.error ? "error" : "ok",
      error: result.error ?? null,
    },
  });
  revalidatePath("/whatsapp");
  return result;
}

export async function sendRemindersNow(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const r = await sendReminders();
  if (r.ok && r.sent) return { ok: true, message: "Lembretes enviados para o seu WhatsApp." };
  if (r.ok && !r.sent) return { ok: true, message: r.message ?? "Nada a lembrar agora." };
  return { ok: false, message: r.error ?? "Falha ao enviar lembretes." };
}

export async function clearWhatsAppLog() {
  await requireAdmin();
  await prisma.whatsAppMessage.deleteMany({});
  revalidatePath("/whatsapp");
}
