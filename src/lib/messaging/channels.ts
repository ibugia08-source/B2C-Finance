import { formatarTelefone, mascararTelefone, normalizarWhatsApp, variantesDoNumero } from "./phone";

/**
 * CANAIS DE MENSAGERIA (29/09/2026 — Fase 16). Sem dependência de servidor
 * (a tela importa daqui).
 *
 * A identidade de quem fala é SEMPRE canal + identificador externo, e o
 * identificador é o que o canal garante que não muda:
 *  · WHATSAPP — o telefone (E.164 sem "+"; aceita a variante do nono dígito);
 *  · TELEGRAM — o Telegram User ID (inteiro positivo). O @username NÃO serve:
 *    o usuário troca quando quer, e outra pessoa pode passar a usá-lo.
 */

export const CANAIS = ["TELEGRAM", "WHATSAPP"] as const;
export type Canal = (typeof CANAIS)[number];

export const ROTULO_DO_CANAL: Record<Canal, string> = { TELEGRAM: "Telegram", WHATSAPP: "WhatsApp" };

/** Telegram User ID: inteiro positivo (hoje até 52 bits; aceitamos até 16 dígitos). */
const TELEGRAM_ID = /^[1-9][0-9]{0,15}$/;

/** Identificador digitado/recebido → forma canônica do canal (null = inválido). */
export function normalizarIdentificador(canal: Canal, raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (canal === "WHATSAPP") return normalizarWhatsApp(String(raw));
  const v = String(raw).trim();
  return TELEGRAM_ID.test(v) ? v : null;
}

/** Formas equivalentes do mesmo identificador (WhatsApp: com e sem o nono dígito). */
export function variantesDoIdentificador(canal: Canal, id: string): string[] {
  return canal === "WHATSAPP" ? variantesDoNumero(id) : [id];
}

/** Para a trilha e logs: nunca o identificador inteiro. */
export function mascararIdentificador(canal: Canal, id: string): string {
  if (canal === "WHATSAPP") return mascararTelefone(id);
  return id.length <= 4 ? "•".repeat(id.length) : `${id.slice(0, 2)}${"•".repeat(id.length - 4)}${id.slice(-2)}`;
}

/** Para a tela. */
export function formatarIdentificador(canal: Canal, id: string, metadata?: { username?: string | null } | null): string {
  if (canal === "WHATSAPP") return formatarTelefone(id);
  return metadata?.username ? `ID ${id} · @${metadata.username}` : `ID ${id}`;
}

/** @username do Telegram (só exibição): 5 a 32 caracteres, letras, números e _. */
export function normalizarUsernameTelegram(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(v) ? v : null;
}

/**
 * Metadados guardados junto ao vínculo — SÓ exibição, nunca identidade.
 * Campos desconhecidos são descartados; texto é limitado.
 */
export function metadadosDoCanal(
  canal: Canal,
  m: { username?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined
): Record<string, string> | null {
  if (canal !== "TELEGRAM" || !m) return null;
  const out: Record<string, string> = {};
  const username = normalizarUsernameTelegram(m.username);
  if (username) out.username = username;
  for (const k of ["firstName", "lastName"] as const) {
    const v = String(m[k] ?? "").trim().slice(0, 64);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
