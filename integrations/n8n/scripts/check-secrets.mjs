#!/usr/bin/env node
/**
 * Falha se algum arquivo de integrations/n8n, docs/ ou .env*.example contiver
 * segredo com cara de verdadeiro: token de integração B2C, chave
 * OpenAI/Anthropic, token da Meta, token de bot do Telegram, chave de API
 * (Qdrant), CRON_SECRET, senha, JWT, "Bearer <token>" literal, ou id de
 * credencial que não seja o placeholder.
 *
 *   node integrations/n8n/scripts/check-secrets.mjs      (npm run n8n:check)
 *
 * Roda no CI (e em tests/integracao-n8n.test.ts). Workflows exportados do
 * n8n guardam só a REFERÊNCIA da credencial — mas um token colado num campo
 * de cabeçalho ou numa expressão vai junto no export; é isso que isto pega.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

export const PADROES = [
  { nome: "token de integração B2C", re: /b2c_(live|test)_[a-z0-9]{8}_[A-Za-z0-9_-]{43}/ },
  { nome: "chave OpenAI", re: /sk-(proj-)?[A-Za-z0-9_-]{24,}/ },
  { nome: "chave Anthropic", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { nome: "token da Meta", re: /EAA[A-Za-z0-9]{40,}/ },
  { nome: "Bearer literal", re: /Bearer\s+(?!YOUR_API_TOKEN|<)(?![^\s]*\.\.\.)[A-Za-z0-9._~+/-]{20,}/ },
  { nome: "id de credencial real", re: /"credentials"[\s\S]{0,120}?"id":\s*"(?!CONFIGURAR_[A-Z0-9_]+")[^"]+"/ },
  // Fase 16 · bloco 3
  { nome: "token de bot do Telegram", re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/ },
  { nome: "chave de API atribuída (Qdrant etc.)", re: /(?:QDRANT_API_KEY|api[_-]?key)["']?\s*[:=]\s*["']?(?!YOUR_|COLE_|CONFIGURAR_|<|\$\{|\{\{)[A-Za-z0-9_.-]{24,}/i },
  { nome: "CRON_SECRET com valor", re: /CRON_SECRET\s*=\s*["']?(?!YOUR_|<|\s|$)[A-Za-z0-9_+/=-]{16,}/ },
  { nome: "senha com valor", re: /(?:PASSWORD|SENHA)\s*=\s*["']?(?!YOUR_|<|\s|$|troque|change)[^\s"']{8,}/i },
  { nome: "JWT", re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
];

const RAIZ_REPO = join(RAIZ, "..", "..");
/** Além de integrations/n8n: a documentação e os exemplos de ambiente. */
export const RAIZES_EXTRAS = ["docs", ".env.example", ".env.production.example"].map((r) => join(RAIZ_REPO, r));

function arquivos(dir) {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

const TEXTO = /\.(md|json|mjs|cjs|js|ts|sh|example|txt|ya?ml|html)$/;

export function verificar(raiz = RAIZ, extras = raiz === RAIZ ? RAIZES_EXTRAS : []) {
  const achados = [];
  for (const arq of [...arquivos(raiz), ...extras.flatMap(arquivos)]) {
    if (arq.endsWith("check-secrets.mjs")) continue; // os próprios padrões
    if (!TEXTO.test(arq) && !arq.endsWith("ENV.example")) continue;
    const texto = readFileSync(arq, "utf8");
    for (const p of PADROES) if (p.re.test(texto)) achados.push(`${relative(raiz, arq)}: ${p.nome}`);
  }
  return achados;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const achados = verificar();
  if (achados.length) {
    console.error("Possíveis segredos (integrations/n8n, docs, .env*.example):\n  " + achados.join("\n  "));
    process.exit(1);
  }
  console.log("integrations/n8n, docs e .env*.example: nenhum segredo encontrado.");
}
