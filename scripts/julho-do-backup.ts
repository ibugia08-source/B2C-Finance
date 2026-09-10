/**
 * JULHO/2026 CONFORME O BACKUP PRÉ-RESET — SOMENTE LEITURA.
 *
 * Fonte: backup-inicio-limpo-2026-09-01-10-01-24.json, o dump que
 * scripts/inicio-limpo.ts grava ANTES de apagar todo o movimento (a
 * "última atualização completa do sistema", em 01/09/2026). É o último
 * retrato do sistema como ele estava antes de começar do zero.
 *
 * Uso:
 *   npx tsx scripts/julho-do-backup.ts            # lista
 *   npx tsx scripts/julho-do-backup.ts --csv      # grava dois CSV
 */
import { readFileSync, writeFileSync } from "fs";

const ARQUIVO =
  process.env.BACKUP ??
  "../backup-inicio-limpo-2026-09-01-10-01-24.json";
const CSV = process.argv.includes("--csv");

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";

const dump = JSON.parse(readFileSync(ARQUIVO, "utf8"));
const nomeDoCliente = new Map<string, string>(
  (dump.Client ?? []).map((c: any) => [c.id, c.name])
);
// Pagamentos por cobrança: é o que diz QUANDO o dinheiro entrou.
const pagamentosPorCobranca = new Map<string, any[]>();
for (const p of dump.Payment ?? []) {
  const l = pagamentosPorCobranca.get(p.billingId) ?? [];
  l.push(p);
  pagamentosPorCobranca.set(p.billingId, l);
}

const julho = (dump.Billing ?? [])
  .filter((b: any) => b.competenceYear === 2026 && b.competenceMonth === 7)
  .map((b: any) => {
    const pags = (pagamentosPorCobranca.get(b.id) ?? []).sort(
      (a: any, z: any) => +new Date(a.paidAt) - +new Date(z.paidAt)
    );
    return {
      cliente: nomeDoCliente.get(b.clientId) ?? "(cliente removido)",
      descricao: b.description,
      valor: Number(b.amount),
      pago: Number(b.paidTotal ?? 0),
      vencimento: b.dueDate,
      status: b.status,
      tipo: b.revenueType,
      pagoEm: pags.length ? pags[pags.length - 1].paidAt : null,
      meio: pags.length ? pags[pags.length - 1].method : null,
    };
  })
  .sort((a: any, z: any) => a.cliente.localeCompare(z.cliente, "pt-BR"));

const pagaram = julho.filter((r: any) => r.status === "PAID");
const inadimplentes = julho.filter((r: any) => r.status !== "PAID" && r.status !== "CANCELED");
const soma = (l: any[], campo: "valor" | "pago") =>
  l.reduce((s, r) => s + r[campo], 0);

console.log("=".repeat(78));
console.log("JULHO/2026 — backup de 01/09/2026 (antes do reset completo do sistema)");
console.log("=".repeat(78));
console.log(
  `\n${julho.length} cobranças · faturado ${brl(soma(julho, "valor"))}` +
    ` · recebido ${brl(soma(julho, "pago"))}` +
    ` · em aberto ${brl(soma(inadimplentes, "valor") - soma(inadimplentes, "pago"))}`
);

console.log(`\n\n■ INADIMPLENTES — ${inadimplentes.length} cliente(s) · ${brl(soma(inadimplentes, "valor") - soma(inadimplentes, "pago"))} em aberto\n`);
console.log("   CLIENTE                          VENCIMENTO      VALOR   STATUS");
console.log("   " + "-".repeat(70));
for (const r of inadimplentes)
  console.log(
    `   ${r.cliente.slice(0, 30).padEnd(30)}   ${dia(r.vencimento).padEnd(12)} ${brl(r.valor).padStart(11)}   ${r.status}` +
      (r.pago > 0 ? `  (parcial: ${brl(r.pago)})` : "")
  );

console.log(`\n\n■ PAGARAM — ${pagaram.length} cliente(s) · ${brl(soma(pagaram, "pago"))}\n`);
console.log("   CLIENTE                          PAGO EM         VALOR   MEIO");
console.log("   " + "-".repeat(70));
for (const r of pagaram)
  console.log(
    `   ${r.cliente.slice(0, 30).padEnd(30)}   ${dia(r.pagoEm).padEnd(12)} ${brl(r.pago).padStart(11)}   ${r.meio ?? "—"}`
  );

if (CSV) {
  const linha = (r: any) =>
    [r.cliente, r.descricao, r.tipo, dia(r.vencimento), dia(r.pagoEm), r.valor.toFixed(2), r.pago.toFixed(2), r.status]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(";");
  const cab = "Cliente;Descrição;Tipo;Vencimento;Pago em;Valor;Recebido;Status";
  writeFileSync("julho-2026-pagaram.csv", [cab, ...pagaram.map(linha)].join("\n") + "\n", "latin1");
  writeFileSync("julho-2026-inadimplentes.csv", [cab, ...inadimplentes.map(linha)].join("\n") + "\n", "latin1");
  console.log("\n\n✓ julho-2026-pagaram.csv e julho-2026-inadimplentes.csv gravados (Excel pt-BR: ; e latin1)");
}
