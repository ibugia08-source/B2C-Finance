import { createHmac, timingSafeEqual, randomBytes } from "crypto";

/**
 * Sessão própria: cookie httpOnly contendo `payload.signature`.
 * Payload é JSON Base64URL com { uid, role, exp }.
 * Assinatura HMAC-SHA256 com SESSION_SECRET.
 *
 * Sem dependências externas (next-auth, jose, iron-session).
 */

const SECRET = (() => {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    // Fail-closed: sem secret em produção, qualquer fallback publicado no
    // repositório permitiria forjar cookies de sessão.
    throw new Error("SESSION_SECRET não definido — obrigatório em produção.");
  }
  return "b2c-dev-secret-change-me-please-32chars-or-more";
})();

const DEFAULT_TTL_DAYS = 30;
export const SESSION_COOKIE = "b2c_session";

export type SessionPayload = {
  uid: string;
  role: "ADMIN" | "USER";
  exp: number; // epoch seconds
};

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(data: string): string {
  return b64urlEncode(createHmac("sha256", SECRET).update(data).digest());
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">, ttlDays = DEFAULT_TTL_DAYS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const full: SessionPayload = { ...payload, exp };
  const body = b64urlEncode(JSON.stringify(full));
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = sign(body);
  // timingSafeEqual exige mesmo length
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function generateSecret(bytes = 48): string {
  return b64urlEncode(randomBytes(bytes));
}
