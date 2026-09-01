import { loadEnv } from "./env";
loadEnv();

/**
 * RODADA DOS RELATÓRIOS AGENDADOS (F5.7).
 *
 *   npx tsx scripts/relatorios-agendados.ts   (ou: npm run relatorios:agendados)
 *
 * Pensado para rodar em cron diário. A janela é recuperável: rodar mais de
 * uma vez no mesmo período não envia dobrado (lastRunAt + dedupe do Outbox),
 * e pular um dia não perde a semana — a próxima rodada cobre.
 */
async function main() {
  const { executarAgendamentos } = await import("@/lib/services/scheduled-reports");
  const r = await executarAgendamentos();
  console.log(
    `relatórios agendados: ${r.examinados} examinados · ${r.enviados} enviados · ${r.pulados.length} pulados`
  );
  for (const p of r.pulados) console.log(`   ${p.id}: ${p.motivo}`);
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
