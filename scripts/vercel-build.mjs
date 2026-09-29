#!/usr/bin/env node
/**
 * BUILD DA VERCEL (`npm run build`, chamado pelo vercel.json).
 *
 * Padrão (sem variável): exatamente o de sempre —
 *   prisma generate → prisma migrate deploy → bootstrap → next build.
 *
 * PUBLICAÇÃO SÓ DE CÓDIGO (sem migration e sem bootstrap): defina no
 * ambiente de BUILD da Vercel
 *
 *   B2C_SKIP_DB_STEPS=<nome da última migration que já está em produção>
 *   (ex.: 20260929100000_messaging_identity_preferences)
 *
 * e o build roda só prisma generate → next build. O valor precisa ser o nome
 * da migration MAIS NOVA do repositório: se o commit trouxer uma migration
 * mais nova, o build FALHA (não pula em silêncio) — publicar código que
 * depende de coluna nova sem aplicar a migration quebraria em produção.
 * Assim a variável esquecida ligada não esconde migration futura.
 *
 * `B2C_SKIP_DB_STEPS=1` (ou qualquer valor que não seja nome de migration) é
 * recusado pelo mesmo motivo.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Nome da migration mais nova do repositório (pastas AAAAMMDDHHMMSS_nome). */
export function ultimaMigration(raiz = RAIZ) {
  const dir = join(raiz, "prisma", "migrations");
  const nomes = readdirSync(dir).filter((n) => /^\d{14}_/.test(n) && statSync(join(dir, n)).isDirectory());
  return nomes.sort().at(-1) ?? null;
}

/** Passos do build para este ambiente. Lança erro se o pulo não for seguro. */
export function planoDeBuild(env, ultima) {
  const pulo = (env.B2C_SKIP_DB_STEPS ?? "").trim();
  if (!pulo) {
    return {
      pulaBanco: false,
      passos: [["prisma", "generate"], ["prisma", "migrate", "deploy"], ["tsx", "prisma/bootstrap.ts"], ["next", "build"]],
    };
  }
  if (!/^\d{14}_[a-z0-9_]+$/.test(pulo)) {
    throw new Error(
      `B2C_SKIP_DB_STEPS="${pulo}" não é nome de migration. Use o nome da última migration já aplicada em produção (ex.: ${ultima}).`
    );
  }
  if (pulo !== ultima) {
    throw new Error(
      pulo < ultima
        ? `Este commit traz migration nova (${ultima}) depois de ${pulo}. Publicação sem migration recusada: remova B2C_SKIP_DB_STEPS e aplique a migration pelo fluxo normal.`
        : `B2C_SKIP_DB_STEPS=${pulo} não existe no repositório (a mais nova é ${ultima}).`
    );
  }
  return { pulaBanco: true, passos: [["prisma", "generate"], ["next", "build"]] };
}

function rodar([bin, ...args]) {
  console.log(`\n$ ${bin} ${args.join(" ")}`);
  const r = spawnSync("npx", ["--no-install", bin, ...args], { stdio: "inherit", cwd: RAIZ, env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ultima = ultimaMigration();
  let plano;
  try {
    plano = planoDeBuild(process.env, ultima);
  } catch (e) {
    console.error(`\n✖ ${e.message}\n`);
    process.exit(1);
  }
  if (plano.pulaBanco) {
    console.log(
      `\n⚠ B2C_SKIP_DB_STEPS=${ultima}: publicação SÓ DE CÓDIGO — sem prisma migrate deploy e sem bootstrap.` +
        "\n  Remova a variável depois desta publicação."
    );
  }
  for (const p of plano.passos) rodar(p);
}
