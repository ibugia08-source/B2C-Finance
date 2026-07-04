import { prisma } from "@/lib/prisma";

export type WhatsAppSettings = {
  provider: string; // zapi | evolution | custom
  baseUrl: string | null;
  instanceId: string | null;
  token: string | null;
  clientToken: string | null;
  myNumber: string | null;
  remindersSecret: string | null;
  enabled: boolean;
};

const SINGLETON_ID = "default";

export async function getWhatsAppSettings(): Promise<WhatsAppSettings | null> {
  const s = await prisma.whatsAppSetting.findUnique({ where: { id: SINGLETON_ID } });
  if (!s) return null;
  return {
    provider: s.provider ?? "zapi",
    baseUrl: s.baseUrl,
    instanceId: s.instanceId,
    token: s.token,
    clientToken: s.clientToken,
    myNumber: s.myNumber,
    remindersSecret: s.remindersSecret,
    enabled: s.enabled,
  };
}

export function isWhatsAppReady(s: WhatsAppSettings | null): s is WhatsAppSettings {
  return !!s && s.enabled && !!s.baseUrl && !!s.myNumber;
}

/** Só dígitos (E.164 sem '+'). */
export function normalizeNumber(n: string | null | undefined): string {
  return (n ?? "").replace(/\D/g, "");
}

export function isAllowedSender(from: string | null | undefined, s: WhatsAppSettings): boolean {
  const a = normalizeNumber(from);
  const b = normalizeNumber(s.myNumber);
  if (!a || !b) return false;
  // tolera DDI/9 extra: compara os últimos 8–11 dígitos
  const tail = (x: string) => x.slice(-Math.min(11, x.length));
  return tail(a) === tail(b) || a.endsWith(b) || b.endsWith(a);
}

/**
 * Envia texto via gateway. Padrão Z-API; tolera Evolution/custom.
 * Retorna {ok, error?}.
 */
export async function sendText(
  to: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const s = await getWhatsAppSettings();
  if (!s || !s.baseUrl) return { ok: false, error: "WhatsApp não configurado." };

  const phone = normalizeNumber(to);
  const base = s.baseUrl.replace(/\/$/, "");

  let url: string;
  let body: any;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (s.provider === "evolution") {
    // Evolution API: POST {base}/message/sendText/{instance}
    url = `${base}/message/sendText/${s.instanceId ?? ""}`;
    if (s.token) headers["apikey"] = s.token;
    body = { number: phone, text: message };
  } else {
    // Z-API (default): POST {base}/instances/{id}/token/{token}/send-text
    url = `${base}/instances/${s.instanceId ?? ""}/token/${s.token ?? ""}/send-text`;
    if (s.clientToken) headers["Client-Token"] = s.clientToken;
    body = { phone, message };
  }

  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `Gateway respondeu ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Falha de rede ao enviar: ${e?.message ?? e}` };
  }
}
