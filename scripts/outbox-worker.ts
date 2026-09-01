import { runOutboxWorker } from "@/lib/outbox";
import { entregarNoCrm, urlConfigurada, segredoConfigurado } from "@/lib/integrations/avancecrm";
import { prisma } from "@/lib/prisma";

/**
 * WORKER DE ENTREGA DO OUTBOX (F4.8 · ref. 03 §4.2).
 *
 *   npx tsx scripts/outbox-worker.ts
 *
 * Roda FORA da transação financeira, com recuo exponencial e dead-letter —
 * é o mecanismo que já existia desde a F0.10; o que a F4.8 acrescenta é o
 * primeiro entregador de verdade.
 *
 * Canal sem entregador configurado NÃO é tratado como falha: o evento fica
 * PENDENTE esperando a configuração chegar. Marcá-lo como erro encheria a
 * dead-letter de eventos perfeitamente válidos que só não tinham para onde ir.
 */
async function main() {
  const temCrm = !!urlConfigurada() && !!segredoConfigurado();
  if (!temCrm) {
    console.log("· AvanceCRM não configurado (AVANCECRM_WEBHOOK_URL/SECRET).");
    console.log("  Os eventos do canal `crm` ficam pendentes até a configuração existir.");
  }

  const r = await runOutboxWorker(async (evento) => {
    // O AvanceCRM é o provedor dos DOIS canais: `crm` (sincronia de fatos) e
    // `whatsapp` (F5.1 — pedido de envio de mensagem da régua, sempre
    // originado por um clique humano; decisão 19.17). O envelope leva o
    // eventType, e é por ele que o provedor decide o que fazer.
    if (evento.channel === "crm" || evento.channel === "whatsapp") {
      if (!temCrm) throw new Error("AvanceCRM não configurado.");
      await entregarNoCrm(evento);
      return;
    }
    // E-mail entra quando houver provedor. Lançar aqui é o certo:
    // o worker reagenda e o evento espera, em vez de sumir como entregue.
    throw new Error(`Canal “${evento.channel}” ainda não tem entregador.`);
  });

  console.log(
    `outbox: ${r.processados} processados · ${r.entregues} entregues · ` +
      `${r.reagendados} reagendados · ${r.deadLetter} em dead-letter`
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
