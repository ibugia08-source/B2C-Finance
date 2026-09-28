import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * TOKENS DA API (28/09/2026).
 *
 * Formato: `b2c_live_<prefixo 8>_<segredo 43>`
 *  · `b2c_live_` deixa o token reconhecível por varredores de segredo
 *    (GitHub secret scanning, gitleaks) e por quem o encontra num log;
 *  · o prefixo (8 caracteres [a-z0-9]) é PÚBLICO: é a chave de busca no
 *    banco e o que a tela mostra para identificar a chave;
 *  · o segredo são 32 bytes aleatórios (256 bits) em base64url.
 *
 * Armazenamento: só `sha256(token completo)` em hex. Com 256 bits de
 * entropia, força bruta offline é inviável mesmo com o banco vazado — por
 * isso SHA-256 basta (bcrypt/argon existem para senha humana, de baixa
 * entropia) e não há "pepper" a perder ou rotacionar.
 */

export const TOKEN_ENV = "live";
const TOKEN_RE = /^b2c_(live|test)_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;
const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";

function prefixoAleatorio(): string {
  // 36 não divide 256: descarta o viés rejeitando bytes ≥ 252.
  let out = "";
  while (out.length < 8) {
    for (const b of randomBytes(16)) {
      if (b >= 252) continue;
      out += ALFABETO[b % 36];
      if (out.length === 8) break;
    }
  }
  return out;
}

export type TokenGerado = { token: string; tokenPrefix: string; tokenHash: string };

export function gerarToken(): TokenGerado {
  const tokenPrefix = `b2c_${TOKEN_ENV}_${prefixoAleatorio()}`;
  const token = `${tokenPrefix}_${randomBytes(32).toString("base64url")}`;
  return { token, tokenPrefix, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Prefixo público do token, ou null se o formato não confere. */
export function prefixoDoToken(token: string): string | null {
  const m = TOKEN_RE.exec(token);
  return m ? `b2c_${m[1]}_${m[2]}` : null;
}

/** Compara dois hashes hex em tempo constante. */
export function hashesIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== 32 || bb.length !== 32) return false;
  return timingSafeEqual(ba, bb);
}

/** Hash de um token que nunca existiu: a comparação roda mesmo sem linha. */
export const HASH_FANTASMA = hashToken("b2c_live_00000000_" + "0".repeat(43));
