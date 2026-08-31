/**
 * JOB DE INTEGRIDADE (F2.8 · ref. 01 §5.4).
 *
 * Responde três perguntas e falha se qualquer uma delas for "não":
 *   1. o razão fecha (débito = crédito)?
 *   2. alguma fotografia foi adulterada por fora do sistema?
 *   3. algum mês fechado mudou depois de fechado?
 *
 * Roda no CI e pode rodar agendado. Leitura pura — não escreve nada.
 *
 * Uso: APP_ENV=local npx tsx scripts/verify-snapshots.ts [--desde 2026-09-01]
 *
 * `--desde` é o corte a partir do qual a cobertura do razão é exigida. Antes
 * dele, pagamento sem lançamento é o ESPERADO: aquele período entra por um
 * lançamento de abertura só. Sem o corte, o job reprova para sempre num
 * sistema que ligou o razão no meio do caminho — e job que reprova sempre é
 * job desligado.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { conferirIntegridade } = await import("@/lib/snapshots/integrity");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { prisma } = await import("@/lib/prisma");

  const i = process.argv.indexOf("--desde");
  const desde = i > -1 && process.argv[i + 1] ? new Date(`${process.argv[i + 1]}T00:00:00`) : null;

  const r = await runWithoutScope(async () => conferirIntegridade({ desde }));
  if (desde) console.log(`\ncorte do razão: ${desde.toLocaleDateString("pt-BR")}`);

  console.log("\nRAZÃO");
  if (!r.razaoLigado) {
    console.log("   desligado neste ambiente — nada a balancear");
  } else {
    console.log(`   balanceado: ${r.razaoBalanceado ? "sim" : "NÃO"} (${r.lancamentosDesbalanceados} lançamentos fora)`);
    console.log(`   pagamentos sem lançamento: ${r.pagamentosSemLancamento}`);
  }

  console.log(`\nFOTOGRAFIAS — ${r.fotografiasConferidas} conferidas`);
  if (r.divergencias.length === 0) {
    console.log("   nenhuma divergência");
  } else {
    for (const d of r.divergencias) {
      console.log(`   ${d.competence} v${d.versao}:`);
      if (d.adulteradas.length)
        console.log(`      ADULTERADA (escrita por fora): ${d.adulteradas.join(", ")}`);
      if (d.mudaramDesdeOFechamento.length)
        console.log(`      mudou depois de fechada: ${d.mudaramDesdeOFechamento.join(", ")}`);
    }
  }

  console.log(
    "\nO QUE ISTO PEGA: linha que existia no fechamento e foi ALTERADA depois." +
      "\nO QUE NÃO PEGA, de propósito: fato CRIADO depois do corte — pagamento" +
      "\nde cobrança antiga é normal (01 §5.6) e não é divergência." +
      "\nIndicadores ficam fora do recálculo: dependem de HOJE (vencido), e" +
      "\nincluí-los faria o job reprovar todo dia."
  );

  await prisma.$disconnect();
  if (!r.ok) {
    console.error("\nIntegridade REPROVADA.");
    process.exit(1);
  }
  console.log("\nIntegridade aprovada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
