/**
 * GUARDA DE AMBIENTE DOS SCRIPTS (F0.1 — ref. 03 §4.6).
 *
 * Regra da especificação: "script destrutivo exige ALLOW_DESTRUCTIVE=true +
 * ambiente explícito". Aqui isso vira uma única porta de entrada, usada por
 * todo script que escreve/apaga dados.
 *
 * Três travas independentes (uma falha, o script morre):
 *   1. APP_ENV declarado explicitamente (local | staging | production);
 *   2. ALLOW_DESTRUCTIVE=true;
 *   3. o APP_ENV declarado BATE com o ambiente inferido da URL do banco —
 *      é a trava que impede "APP_ENV=local" apontando para produção.
 *
 * Produção exige, além disso, `allowProduction: true` no código do script.
 * Nenhum script do repositório passa essa opção: rodar contra produção é
 * uma decisão de código revisada, nunca de variável de ambiente.
 */

export type AppEnv = "local" | "staging" | "production";

const VALID: AppEnv[] = ["local", "staging", "production"];

/** URL efetiva do banco (mesma precedência do schema.prisma). */
export function resolveDatabaseUrl(): string {
  return (
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL ||
    ""
  );
}

/**
 * Deduz o ambiente pela URL: host local → local; nome do banco/host com
 * "staging" → staging; qualquer outro host remoto → production.
 * Conservador de propósito: na dúvida, trata como produção.
 */
export function inferEnvFromUrl(url: string): AppEnv | "unknown" {
  if (!url) return "unknown";
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname;
  } catch {
    return "unknown";
  }
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return "local";
  if (/staging|homolog/i.test(host + path)) return "staging";
  return "production";
}

function fail(lines: string[]): never {
  console.error("\n✖ Bloqueado pela guarda de ambiente (03 §4.6)\n");
  for (const l of lines) console.error("  " + l);
  console.error("");
  process.exit(1);
}

/**
 * Autoriza (ou mata) um script que altera dados.
 *
 * @param script    nome legível, só para a mensagem de erro
 * @param allowEnvs ambientes onde este script pode rodar (padrão: local, staging)
 * @param allowProduction  precisa ser true no CÓDIGO para tocar produção
 */
export function assertDestructiveAllowed(opts: {
  script: string;
  allowEnvs?: AppEnv[];
  allowProduction?: boolean;
}): AppEnv {
  const { script } = opts;
  const allowEnvs = opts.allowEnvs ?? ["local", "staging"];
  const declared = (process.env.APP_ENV ?? "").trim() as AppEnv;
  const url = resolveDatabaseUrl();
  const inferred = inferEnvFromUrl(url);

  if (!declared) {
    fail([
      `${script} altera dados e exige o ambiente declarado.`,
      `Rode com:  APP_ENV=${inferred === "unknown" ? "local" : inferred} ALLOW_DESTRUCTIVE=true npx tsx ${script}`,
    ]);
  }
  if (!VALID.includes(declared)) {
    fail([`APP_ENV="${declared}" é inválido. Use: ${VALID.join(" | ")}.`]);
  }
  if (process.env.ALLOW_DESTRUCTIVE !== "true") {
    fail([
      `${script} altera dados e exige ALLOW_DESTRUCTIVE=true.`,
      `Rode com:  APP_ENV=${declared} ALLOW_DESTRUCTIVE=true npx tsx ${script}`,
    ]);
  }
  if (inferred === "unknown") {
    fail([
      "Não consegui identificar o banco de destino (URL ausente ou inválida).",
      "Confira POSTGRES_URL_NON_POOLING / POSTGRES_PRISMA_URL no .env.",
    ]);
  }
  if (declared !== inferred) {
    fail([
      `APP_ENV declarado é "${declared}", mas o banco configurado é "${inferred}".`,
      `Banco: ${redact(url)}`,
      "Corrija o .env ou o APP_ENV — nunca os dois ao mesmo tempo, sem conferir.",
    ]);
  }
  if (inferred === "production" && !opts.allowProduction) {
    fail([
      `${script} NÃO pode rodar contra produção.`,
      "Autorizar produção é mudança de código revisada (allowProduction), não variável de ambiente.",
    ]);
  }
  if (!allowEnvs.includes(inferred)) {
    fail([
      `${script} só roda em: ${allowEnvs.join(", ")}. Ambiente atual: ${inferred}.`,
    ]);
  }

  console.log(`· ambiente: ${inferred} · ${redact(url)}`);
  return inferred;
}

/** Esconde a senha da URL antes de imprimir/logar (03 §4.6: PII fora do log). */
export function redact(url: string): string {
  return url.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
}

/**
 * Guarda leve para scripts SENSÍVEIS que não apagam nada (ex.: emitir token
 * de sessão administrativa). Não exige ALLOW_DESTRUCTIVE — apenas recusa
 * produção, onde o efeito colateral seria uma sessão de admin real.
 */
export function assertNotProduction(script: string): AppEnv {
  const url = resolveDatabaseUrl();
  const inferred = inferEnvFromUrl(url);
  if (inferred === "unknown") {
    fail([
      "Não consegui identificar o banco de destino (URL ausente ou inválida).",
      "Confira POSTGRES_URL_NON_POOLING / POSTGRES_PRISMA_URL no .env.",
    ]);
  }
  if (inferred === "production") {
    fail([`${script} não roda contra produção.`, `Banco: ${redact(url)}`]);
  }
  return inferred;
}
