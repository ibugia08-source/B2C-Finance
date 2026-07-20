import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware leve: só checa presença + validade básica do cookie de sessão.
 * Validação completa (HMAC + DB) é feita em getCurrentUser nas server pages.
 *
 * Observação: o middleware roda no Edge runtime; não importamos prisma
 * nem bcryptjs aqui. Apenas verifica o formato do token e expiração via
 * Web Crypto.
 */

const SESSION_COOKIE = "b2c_session";

const SECRET =
  process.env.SESSION_SECRET ??
  "b2c-dev-secret-change-me-please-32chars-or-more";

const PUBLIC_PATHS = new Set<string>(["/login"]);

function b64urlDecodeToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // @ts-ignore - Buffer existe em Node runtime
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // @ts-ignore
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function hmacSha256(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return bytesToB64Url(new Uint8Array(sig));
}

async function isSessionValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  const expected = await hmacSha256(SECRET, body);
  if (sig !== expected) return false;

  try {
    const json = new TextDecoder().decode(b64urlDecodeToBytes(body));
    const payload = JSON.parse(json) as { exp?: number };
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = await isSessionValid(token);

  // /login: se já logado, manda para dashboard
  if (PUBLIC_PATHS.has(pathname)) {
    if (valid) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Demais rotas: exige sessão
  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /**
     * Protege tudo, exceto:
     *  - rotas internas do Next (_next/*)
     *  - assets estáticos (favicon, imagens etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)",
  ],
};
