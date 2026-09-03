/**
 * CONFERÊNCIA DA CONVERSÃO PARA timestamptz (F0.4 — ref. 01 §3.15).
 *
 * Tira um retrato dos instantes (em UTC) de colunas de data representativas e
 * compara depois da migration. A conversão usa `AT TIME ZONE 'UTC'`, então o
 * INSTANTE precisa ser idêntico — qualquer diferença é deslocamento de fuso.
 *
 * Uso: node scripts/verify-timestamps.mjs --snapshot|--check <arquivo.json> [--db nome]
 */
import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";

const require = createRequire(new URL("../../.devdb/", import.meta.url).href + "x.js");
const { Client } = require("pg");

const ALVOS = [
  ["Billing", "dueDate"], ["Billing", "paidAt"], ["Billing", "createdAt"],
  ["Payment", "paidAt"], ["Income", "receivedAt"], ["Transaction", "date"],
  ["Transaction", "dueDate"], ["Client", "startedAt"], ["Client", "churnedAt"],
  ["Contract", "startDate"], ["Contract", "endDate"], ["ClientLoss", "lostAt"],
  ["ClientRenewal", "renewedAt"], ["CollectionHistory", "createdAt"],
];

const args = process.argv.slice(2);
const modo = args.includes("--snapshot") ? "snapshot" : args.includes("--check") ? "check" : null;
const arquivo = args[args.indexOf(modo === "snapshot" ? "--snapshot" : "--check") + 1];
const dbFlag = args.indexOf("--db");
const database = dbFlag >= 0 ? args[dbFlag + 1] : "b2c_finance_dev";
if (!modo || !arquivo) {
  console.error("Uso: node scripts/verify-timestamps.mjs --snapshot|--check <arquivo.json> [--db nome]");
  process.exit(1);
}

const c = new Client({ host: "127.0.0.1", port: 55432, user: "b2cdev", password: "b2cdev", database });
await c.connect();
// Sessão em UTC + cast para timestamp: torna a leitura INDEPENDENTE do tipo da
// coluna. Em `timestamptz`, o cast renderiza o instante em UTC; em `timestamp`
// (que o Prisma sempre gravou em UTC), é identidade. Sem isto, `AT TIME ZONE`
// mudaria de sentido conforme o tipo e a comparação antes/depois seria falsa.
await c.query("SET TIME ZONE 'UTC'");
const atual = {};
for (const [tabela, coluna] of ALVOS) {
  // to_char em UTC: independe do tipo da coluna e do fuso da sessão.
  const r = await c.query(
    `SELECT COUNT("${coluna}")::int AS n,
            MIN("${coluna}"::timestamp)::text AS menor,
            MAX("${coluna}"::timestamp)::text AS maior,
            MD5(COALESCE(string_agg(to_char("${coluna}"::timestamp,'YYYY-MM-DD"T"HH24:MI:SS.MS'), '|' ORDER BY "${coluna}"), '')) AS impressao
       FROM "${tabela}"`
  );
  atual[`${tabela}.${coluna}`] = r.rows[0];
}
await c.end();

if (modo === "snapshot") {
  writeFileSync(arquivo, JSON.stringify(atual, null, 1));
  console.log(`✓ retrato de instantes salvo em ${arquivo}`);
  process.exit(0);
}

const antes = JSON.parse(readFileSync(arquivo, "utf8"));
let falhas = 0;
for (const chave of Object.keys(atual)) {
  const a = antes[chave], d = atual[chave];
  if (!a) { console.log(`? ${chave} — ausente no retrato`); continue; }
  const ok = a.n === d.n && a.impressao === d.impressao;
  if (!ok) falhas++;
  if (d.n > 0) {
    console.log(`${ok ? "✓" : "✗"} ${chave.padEnd(32)} ${d.n} valor(es)  ${d.menor ?? ""}`);
  }
}
console.log(`\n${Object.keys(atual).length} colunas conferidas · ${falhas} divergência(s)`);
process.exit(falhas === 0 ? 0 : 1);
