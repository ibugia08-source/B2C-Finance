/**
 * JOB DE VERIFICAÇÃO DO RAZÃO (F1.6 — ref. 01 §5.4).
 *
 * Responde duas perguntas e falha (exit 1) se qualquer uma reprovar:
 *   1. Toda transação tem débito = crédito?
 *   2. Todo pagamento depois do corte tem lançamento?
 *
 * A segunda é a que pega a bandeira desligada por engano — um razão
 * balanceado e VAZIO passa na primeira e não serve para nada.
 *
 * Uso:
 *   APP_ENV=local npx tsx scripts/verify-ledger.ts
 *   ... --desde 2026-09-01   (data de corte; padrão: sem corte)
 *   ... --competencia 2026-08
 */
import { loadEnv } from "./env";
loadEnv();

const args = process.argv.slice(2);
const arg = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : null;
};

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { ledgerHealth } = await import("@/lib/accounting/health");
  const { currentWorkspaceId } = await import("@/lib/services/workspace");

  const workspaceId = await currentWorkspaceId();
  const desdeArg = arg("--desde");
  const desde = desdeArg ? new Date(`${desdeArg}T00:00:00`) : null;
  const competencia = arg("--competencia") as any;

  const h = await ledgerHealth(workspaceId, { desde, competence: competencia ?? undefined });

  console.log(`\n╔═ RAZÃO — verificação`);
  console.log(`║  postagem: ${h.enabled ? "LIGADA" : "DESLIGADA"}`);
  if (competencia) console.log(`║  competência: ${competencia}`);
  if (desde) console.log(`║  corte: ${desde.toLocaleDateString("pt-BR")}`);
  console.log("");

  console.log(`  1. Débito = crédito`);
  console.log(`     ${h.transacoes} transação(ões) conferida(s)`);
  if (h.balanceOk) {
    console.log(`     ✓ todas balanceadas`);
  } else {
    console.log(`     ✗ ${h.desbalanceadas.length} DESBALANCEADA(S):`);
    for (const d of h.desbalanceadas.slice(0, 10)) {
      console.log(`       ${d.id}  diferença ${d.diferenca}`);
    }
  }

  console.log(`\n  2. Cobertura dos fatos`);
  if (!h.enabled) {
    console.log(`     — postagem desligada: nada a cobrar (ligar é decisão de cutover)`);
  } else if (h.cobertura == null) {
    console.log(`     — nenhum pagamento no período`);
  } else {
    const pct = (h.cobertura * 100).toFixed(1);
    console.log(`     ${pct}% dos pagamentos têm lançamento`);
    if (h.pagamentosSemLancamento > 0) {
      console.log(`     ✗ ${h.pagamentosSemLancamento} pagamento(s) SEM lançamento`);
    } else {
      console.log(`     ✓ nenhum pagamento sem lançamento`);
    }
  }

  const reprovou = !h.balanceOk || (h.enabled && h.pagamentosSemLancamento > 0);
  console.log(reprovou ? "\n  RESULTADO: REPROVADO\n" : "\n  RESULTADO: aprovado\n");

  await prisma.$disconnect();
  process.exit(reprovou ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
