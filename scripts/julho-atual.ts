/**
 * JULHO/2026 COMO ESTÁ HOJE EM PRODUÇÃO — SOMENTE LEITURA.
 *   PROD_URL="postgres://..." npx tsx scripts/julho-atual.ts [--csv]
 */
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const CSV = process.argv.includes("--csv");
const prisma = new PrismaClient(
  process.env.PROD_URL ? { datasources: { db: { url: process.env.PROD_URL } } } : undefined
);
const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: any) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");

async function main() {
  const linhas = await prisma.$queryRawUnsafe<any[]>(`
    SELECT c.name AS cliente, b.description, b."revenueType" AS tipo,
           b.amount::float AS valor, b."paidTotal"::float AS pago,
           b."dueDate", b.status, b."isLate", b."paidInDifferentMonth",
           (SELECT max(p."paidAt") FROM "Payment" p WHERE p."billingId" = b.id) AS pago_em,
           (SELECT max(p.method::text) FROM "Payment" p WHERE p."billingId" = b.id) AS meio
    FROM "Billing" b LEFT JOIN "Client" c ON c.id = b."clientId"
    WHERE b."competenceYear" = 2026 AND b."competenceMonth" = 7
    ORDER BY c.name
  `);

  const pagaram = linhas.filter((r) => r.status === "PAID");
  const inad = linhas.filter((r) => r.status !== "PAID" && r.status !== "CANCELED");
  const cancel = linhas.filter((r) => r.status === "CANCELED");
  const soma = (l: any[], k: string) => l.reduce((s, r) => s + Number(r[k]), 0);

  console.log("=".repeat(78));
  console.log("JULHO/2026 — produção, hoje (já com a correção de data aplicada)");
  console.log("=".repeat(78));
  console.log(
    `\n${linhas.length} cobranças · faturado ${brl(soma(linhas, "valor"))}` +
      ` · recebido ${brl(soma(linhas, "pago"))}` +
      ` · em aberto ${brl(soma(inad, "valor") - soma(inad, "pago"))}` +
      (cancel.length ? ` · ${cancel.length} cancelada(s) ${brl(soma(cancel, "valor"))}` : "")
  );

  console.log(`\n\n■ INADIMPLENTES — ${inad.length} · ${brl(soma(inad, "valor") - soma(inad, "pago"))} em aberto\n`);
  console.log("   CLIENTE                          VENCIMENTO      VALOR   STATUS");
  console.log("   " + "-".repeat(70));
  for (const r of inad)
    console.log(
      `   ${String(r.cliente ?? "—").slice(0, 30).padEnd(30)}   ${dia(r.dueDate).padEnd(12)} ${brl(r.valor).padStart(11)}   ${r.status}` +
        (Number(r.pago) > 0 ? `  (parcial: ${brl(r.pago)})` : "")
    );

  console.log(`\n\n■ PAGARAM — ${pagaram.length} · ${brl(soma(pagaram, "pago"))}\n`);
  console.log("   CLIENTE                          PAGO EM         VALOR   MEIO");
  console.log("   " + "-".repeat(70));
  for (const r of pagaram)
    console.log(
      `   ${String(r.cliente ?? "—").slice(0, 30).padEnd(30)}   ${dia(r.pago_em).padEnd(12)} ${brl(r.pago).padStart(11)}   ${r.meio ?? "—"}`
    );

  if (cancel.length) {
    console.log(`\n\n■ CANCELADAS (fora do ciclo do mês) — ${cancel.length}\n`);
    for (const r of cancel)
      console.log(`   ${String(r.cliente ?? "—").slice(0, 30).padEnd(30)}   ${brl(r.valor).padStart(11)}`);
  }

  if (CSV) {
    const linha = (r: any) =>
      [r.cliente, r.description, r.tipo, dia(r.dueDate), dia(r.pago_em), Number(r.valor).toFixed(2), Number(r.pago).toFixed(2), r.status]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";");
    const cab = "Cliente;Descrição;Tipo;Vencimento;Pago em;Valor;Recebido;Status";
    writeFileSync("julho-2026-atual-pagaram.csv", [cab, ...pagaram.map(linha)].join("\n") + "\n", "latin1");
    writeFileSync("julho-2026-atual-inadimplentes.csv", [cab, ...inad.map(linha)].join("\n") + "\n", "latin1");
    console.log("\n✓ CSVs gravados (separador ; e latin1, para o Excel pt-BR)");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("falhou:", e.message); await prisma.$disconnect(); process.exit(1); });
