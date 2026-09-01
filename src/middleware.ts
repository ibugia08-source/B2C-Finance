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

const PUBLIC_PATHS = new Set<string>(["/login"]);

// ===== Rate limit do login por IP (anti força bruta) =====
// Melhor esforço por instância Edge (memória local — sem custo por request).
// Complementa o bloqueio POR CONTA após falhas seguidas (lib/actions/auth.ts),
// que é persistente no banco e pega ataques distribuídos na mesma conta.
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_PER_WINDOW = 10;
const loginHits = new Map<string, { count: number; reset: number }>();

function isLoginRateLimited(ip: string): boolean {
  const now = Date.now();
  // Faxina ocasional para a memória não crescer sem limite.
  if (loginHits.size > 5000) {
    for (const [k, v] of loginHits) if (v.reset < now) loginHits.delete(k);
  }
  const cur = loginHits.get(ip);
  if (!cur || cur.reset < now) {
    loginHits.set(ip, { count: 1, reset: now + LOGIN_WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > LOGIN_MAX_PER_WINDOW;
}

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

  // T7 — correlationId por requisição: carimbado aqui, lido pelo contexto
  // dos motores e gravado no AuditLog. "O que aconteceu nesse clique?" vira
  // uma busca por um id. Se o proxy da frente já mandou um, respeita.
  const correlationId = req.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-correlation-id", correlationId);
  const seguir = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("x-correlation-id", correlationId);
    return res;
  };

  // Formulário público de contratos (/f/{token}): acessível SEM sessão.
  // O token opaco na URL é a credencial; POSTs (respostas) passam pelo mesmo
  // rate limit por IP do login.
  if (pathname === "/f" || pathname.startsWith("/f/")) {
    if (req.method === "POST") {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "unknown";
      if (isLoginRateLimited(ip)) {
        return new NextResponse("Muitas tentativas. Aguarde um minuto.", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
    }
    return seguir();
  }

  // Webhook de entrada (F4.8): provedor externo não faz login. Quem
  // autentica é a ASSINATURA HMAC do corpo, conferida na própria rota em
  // tempo constante — e ela é bem mais forte que uma sessão, porque prova a
  // posse do segredo A CADA requisição.
  //
  // Sem esta exceção o middleware redirecionaria o POST para /login e o
  // AvanceCRM receberia um 307 no lugar do 200: ele reenviaria para sempre e
  // nenhum evento entraria.
  if (pathname.startsWith("/api/webhooks/")) {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "unknown";
    if (isLoginRateLimited(ip)) {
      return new NextResponse("Muitas requisições.", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }
    return seguir();
  }

  // Tentativas de login (POST) limitadas por IP.
  if (pathname === "/login" && req.method === "POST") {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "unknown";
    if (isLoginRateLimited(ip)) {
      return new NextResponse("Muitas tentativas de login. Aguarde um minuto.", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = await isSessionValid(token);

  // /login: se já logado, manda para dashboard
  if (PUBLIC_PATHS.has(pathname)) {
    if (valid) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    return seguir();
  }

  // Demais rotas: exige sessão
  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return seguir();
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
