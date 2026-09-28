#!/usr/bin/env node
/**
 * Falha se algum arquivo de integrations/n8n contiver segredo com cara de
 * verdadeiro: token de integração B2C, chave OpenAI/Anthropic, token da Meta,
 * "Bearer <token>" literal, ou id de credencial que não seja o placeholder.
 *
 *   node integrations/n8n/scripts/check-secrets.mjs      (npm run n8n:check)
 *
 * Roda no CI (e em tests/integracao-n8n.test.ts). Workflows exportados do
 * n8n guardam só a REFERÊNCIA da credencial — mas um token colado num campo
 * de cabeçalho ou numa expressão vai junto no export; é isso que isto pega.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

export const PADROES = [
  { nome: "token de integração B2C", re: /b2c_(live|test)_[a-z0-9]{8}_[A-Za-z0-9_-]{43}/ },
  { nome: "chave OpenAI", re: /sk-(proj-)?[A-Za-z0-9_-]{24,}/ },
  { nome: "chave Anthropic", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { nome: "token da Meta", re: /EAA[A-Za-z0-9]{40,}/ },
  { nome: "Bearer literal", re: /Bearer\s+(?!YOUR_API_TOKEN|<)[A-Za-z0-9._~+/-]{20,}/ },
  { nome: "id de credencial real", re: /"credentials"[\s\S]{0,120}?"id":\s*"(?!CONFIGURAR_NO_N8N")[^"]+"/ },
];

function arquivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

export function verificar(raiz = RAIZ) {
  const achados = [];
  for (const arq of arquivos(raiz)) {
    if (arq.endsWith("check-secrets.mjs")) continue; // os próprios padrões
    const texto = readFileSync(arq, "utf8");
    for (const p of PADROES) if (p.re.test(texto)) achados.push(`${relative(raiz, arq)}: ${p.nome}`);
  }
  return achados;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const achados = verificar();
  if (achados.length) {
    console.error("Possíveis segredos em integrations/n8n:\n  " + achados.join("\n  "));
    process.exit(1);
  }
  console.log("integrations/n8n: nenhum segredo encontrado.");
}
