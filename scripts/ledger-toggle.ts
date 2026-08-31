/**
 * LIGA OU DESLIGA a postagem no razão (F1.6).
 *
 * Operação DELIBERADA, nunca automática, e por isso um script e não uma
 * migration: ligar o razão em produção só faz sentido DEPOIS do
 * lançamento de abertura dos saldos, que depende da data oficial de
 * cutover (DECISÃO 19.32, em aberto). Um razão que começa no meio do mês,
 * sem abertura, produz balanço que não fecha e demora semanas para ser
 * percebido.
 *
 * Uso:
 *   APP_ENV=local ALLOW_DESTRUCTIVE=true npx tsx scripts/ledger-toggle.ts --on
 *   APP_ENV=local ALLOW_DESTRUCTIVE=true npx tsx scripts/ledger-toggle.ts --off
 */
import { loadEnv } from "./env";
import { assertDestructiveAllowed } from "./guard";
loadEnv();
assertDestructiveAllowed({
  script: "scripts/ledger-toggle.ts",
  allowEnvs: ["local", "staging"],
});

const ligar = process.argv.includes("--on");
const desligar = process.argv.includes("--off");
if (ligar === desligar) {
  console.error("Escolha --on ou --off.");
  process.exit(1);
}

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { setLedgerEnabled, ledgerHealth } = await import("@/lib/accounting/health");
  const { currentWorkspaceId } = await import("@/lib/services/workspace");

  const workspaceId = await currentWorkspaceId();
  await setLedgerEnabled(workspaceId, ligar);
  const h = await ledgerHealth(workspaceId);

  console.log(`\n  postagem no razão: ${h.enabled ? "LIGADA" : "DESLIGADA"}`);
  console.log(`  transações existentes: ${h.transacoes}`);
  if (ligar) {
    console.log(
      "\n  LEMBRETE: em produção, ligar só DEPOIS do lançamento de abertura\n" +
        "  dos saldos (depende da DECISÃO 19.32 — data de cutover).\n"
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
