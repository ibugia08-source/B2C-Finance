/**
 * CONFERÊNCIA DO BACKFILL Float → Decimal (F0.3 — ref. 01 §3.14).
 *
 * Soma cada campo monetário e compara com o retrato tirado ANTES da
 * migration. Diferença aceitável: só o arredondamento de centavos que o
 * próprio Float já não representava (tolerância = 0,005 × nº de linhas).
 *
 * Uso:
 *   node scripts/verify-decimal-backfill.mjs --snapshot <arquivo.json>   (antes)
 *   node scripts/verify-decimal-backfill.mjs --check <arquivo.json>      (depois)
 *   ... --db b2c_finance_dev   (padrão: lê a URL do .env)
 */
import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";

const require = createRequire(new URL("../../.devdb/", import.meta.url).href + "x.js");
const { Client } = require("pg");

const CAMPOS = [
  ["Account", "balance"], ["CreditCard", "limitTotal"], ["AccountCard", "limit"],
  ["Transaction", "amount"], ["Installment", "amount"],
  ["CreditCardInvoice", "total"], ["CreditCardInvoice", "paid"],
  ["CreditCardInvoice", "declaredTotal"],
  ["Receivable", "amount"], ["Income", "amount"],
  ["CashBox", "currentAmount"], ["CashBox", "targetAmount"],
  ["PersonPayment", "amount"], ["CashBoxMovement", "amount"],
  ["CategorizationRule", "amountGreaterThan"], ["CategorizationRule", "amountLessThan"],
];

const args = process.argv.slice(2);
const modo = args.includes("--snapshot") ? "snapshot" : args.includes("--check") ? "check" : null;
const arquivo = args[args.indexOf(modo === "snapshot" ? "--snapshot" : "--check") + 1];
const dbFlag = args.indexOf("--db");
const database = dbFlag >= 0 ? args[dbFlag + 1] : null;

if (!modo || !arquivo) {
  console.error("Uso: node scripts/verify-decimal-backfill.mjs --snapshot|--check <arquivo.json> [--db nome]");
  process.exit(1);
}

function conexao() {
  if (database) {
    return { host: "127.0.0.1", port: 55432, user: "b2cdev", password: "b2cdev", database };
  }
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const m = env.match(/^POSTGRES_URL_NON_POOLING\s*=\s*"?([^"\n]+)"?/m)
    || env.match(/^POSTGRES_PRISMA_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!m) { console.error("✖ URL do banco não encontrada no .env"); process.exit(1); }
  return { connectionString: m[1] };
}

const c = new Client(conexao());
await c.connect();
const atual = {};
for (const [tabela, coluna] of CAMPOS) {
  const r = await c.query(
    `SELECT COUNT(*)::int AS linhas, COUNT("${coluna}")::int AS naoNulos,
            COALESCE(SUM("${coluna}"), 0)::text AS soma FROM "${tabela}"`
  );
  atual[`${tabela}.${coluna}`] = {
    linhas: r.rows[0].linhas,
    naoNulos: r.rows[0].naonulos ?? r.rows[0].naoNulos,
    soma: r.rows[0].soma,
  };
}
await c.end();

if (modo === "snapshot") {
  writeFileSync(arquivo, JSON.stringify(atual, null, 1));
  console.log(`✓ retrato salvo em ${arquivo}`);
  process.exit(0);
}

const antes = JSON.parse(readFileSync(arquivo, "utf8"));
let falhas = 0, comparados = 0;
console.log("campo                                    antes            depois           dif");
for (const chave of Object.keys(atual)) {
  const a = antes[chave], d = atual[chave];
  if (!a) { console.log(`? ${chave} — ausente no retrato`); continue; }
  const sa = Number(a.soma), sd = Number(d.soma);
  const dif = sd - sa;
  const tolerancia = Math.max(0.005 * Math.max(a.naoNulos ?? 0, 1), 0.005);
  const ok = Math.abs(dif) <= tolerancia && (a.linhas === d.linhas);
  if (!ok) falhas++;
  comparados++;
  if (sa !== 0 || sd !== 0 || a.linhas !== d.linhas) {
    console.log(
      `${ok ? "✓" : "✗"} ${chave.padEnd(38)} ${String(sa).padEnd(16)} ${String(sd).padEnd(16)} ${dif.toFixed(4)}`
    );
  }
}
console.log(`\n${comparados} campos conferidos · ${falhas} divergência(s)`);
process.exit(falhas === 0 ? 0 : 1);
