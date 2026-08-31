/**
 * Prepara o banco de TESTES (F0.2 — ref. 03 §4.5).
 *
 * Cria b2c_finance_test na instância local (se faltar) e aplica as migrations.
 * A suíte nunca toca dev, staging ou produção: vitest.config.ts fixa a URL e
 * tests/support/db.ts aborta se o destino não for este banco.
 *
 * Uso: npm run db:test:setup   (com o Postgres local no ar)
 */
import { execFileSync } from "child_process";
import { createRequire } from "module";

const HOST = "127.0.0.1";
const PORT = 55432;
const USER = "b2cdev";
const PASS = "b2cdev";
const DB = "b2c_finance_test";
// Nome DB_URL (não URL): `URL` é o construtor global usado logo abaixo.
const DB_URL = `postgres://${USER}:${PASS}@${HOST}:${PORT}/${DB}`;

// O driver pg vive com o Postgres embarcado, fora do repositório.
const require = createRequire(new URL("../../.devdb/", import.meta.url).href + "x.js");
let Client;
try {
  ({ Client } = require("pg"));
} catch {
  console.error("✖ driver pg não encontrado em ../.devdb/node_modules — suba o banco local primeiro.");
  process.exit(1);
}

const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASS, database: "postgres" });
await admin.connect();
const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [DB]);
if (!rowCount) {
  await admin.query(`CREATE DATABASE ${DB}`);
  console.log(`✓ ${DB} criado`);
} else {
  console.log(`· ${DB} já existe`);
}
await admin.end();

// Roles que a migration de segurança espera (existem no Supabase, não aqui).
const db = new Client({ host: HOST, port: PORT, user: USER, password: PASS, database: DB });
await db.connect();
for (const role of ["anon", "authenticated"]) {
  const r = await db.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
  if (!r.rowCount) await db.query(`CREATE ROLE ${role} NOLOGIN`);
}
await db.end();

const env = {
  ...process.env,
  POSTGRES_PRISMA_URL: DB_URL,
  POSTGRES_URL_NON_POOLING: DB_URL,
  APP_ENV: "local",
  ALLOW_DESTRUCTIVE: "true",
};
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env });

// Plano de contas: a suíte verifica a NATUREZA das contas (03 §2.2), então o
// seed faz parte do preparo do banco, não de um teste.
execFileSync("npx", ["tsx", "prisma/seed-chart-of-accounts.ts"], { stdio: "inherit", env });

console.log("✓ banco de testes pronto");
