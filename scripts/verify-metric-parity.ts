/**
 * PARIDADE DO MOTOR DE MÉTRICAS (F0.7 — ref. 01 §7).
 *
 * Compara, mês a mês contra os DADOS REAIS, o valor que o MOTOR devolve com o
 * que as funções do v1 calculavam direto. A exigência da tarefa é substituir
 * os cálculos inline do Dashboard "SEM mudar resultados" — este script é a
 * prova disso, em centavos.
 *
 * Uso: APP_ENV=local npx tsx scripts/verify-metric-parity.ts [ano]
 */
import { loadEnv } from "./env";
import { assertNotProduction } from "./guard";
loadEnv();
// Fora de uma request o unstable_cache do Next lança "incrementalCache
// missing". O helper ownerCached respeita esta variável e executa direto,
// no escopo do dono — é assim que o script exercita EXATAMENTE os mesmos
// serviços que a tela usa. Definir aqui evita ter de lembrar na linha de
// comando (e o esquecimento parecia falha do motor, não do script).
process.env.B2C_DISABLE_CACHE = "1";
assertNotProduction("scripts/verify-metric-parity.ts");

const ANO = parseInt(process.argv[2] ?? "2026", 10);
const CENTAVO = 0.005;

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope, runWithOwner } = await import("@/lib/auth/owner-scope");
  const { computePeriodMetrics } = await import("@/lib/metrics/engine");
  const { getDashboardMainMetrics } = await import("@/lib/services/dashboard-main");
  const { getExecutiveDashboard } = await import("@/lib/services/dashboard-metrics");
  const { getMonthlyChurn, getNewClientsSummary, getMonthlyCostPerClient } = await import(
    "@/lib/financial/calculations"
  );

  const admin = await runWithoutScope(async () =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  if (!admin) throw new Error("Nenhum ADMIN — rode o seed antes.");

  let divergencias = 0;
  let comparacoes = 0;

  await runWithOwner(admin.id, async () => {
    for (let mes = 1; mes <= 12; mes++) {
      const period = {
        key: "mes" as const,
        start: new Date(ANO, mes - 1, 1),
        end: new Date(ANO, mes, 1),
        label: `${String(mes).padStart(2, "0")}/${ANO}`,
      };

      // ===== Caminho NOVO: o motor =====
      const motor = await computePeriodMetrics(period);

      // ===== Caminho ANTIGO: as funções que a tela chamava =====
      const executivo = await getExecutiveDashboard({ period });
      const main = await getDashboardMainMetrics(period);
      const churn = await getMonthlyChurn(period.start, period.end);
      const novos = await getNewClientsSummary(period.start, period.end);
      const M = main.current;
      const ativos = executivo.clients.ativos;

      const antigo: Record<string, number | null> = {
        faturamento_total: M.faturamentoTotal,
        mrr_oficial: M.mrr,
        tcv_faturado: M.tcv,
        receita_extra_reconhecida: M.extraManual,
        recebido_competencia: M.recebido,
        em_aberto: M.emAberto,
        vencido: M.vencido,
        resultado_mes: M.resultado,
        margem_gerencial: M.margem,
        percentual_recorrencia: M.faturamentoTotal > 0 ? M.mrr / M.faturamentoTotal : null,
        percentual_realizacao: M.faturamentoTotal > 0 ? M.recebido / M.faturamentoTotal : null,
        clientes_ativos: ativos,
        novos_clientes: novos.count,
        churn_quantidade: churn.count,
        churn_valor: churn.value,
        ticket_medio: ativos > 0 ? M.faturamentoTotal / ativos : null,
        custo_por_cliente: ativos > 0 ? getMonthlyCostPerClient(executivo.finance.despesas, ativos) : null,
        percentual_folha:
          M.faturamentoTotal > 0 ? executivo.finance.folhaPeriodo / M.faturamentoTotal : null,
      };

      const ruins: string[] = [];
      for (const [chave, esperado] of Object.entries(antigo)) {
        const obtido = motor[chave as keyof typeof motor]?.value ?? null;
        comparacoes++;
        const iguais =
          esperado == null || obtido == null
            ? esperado == null && obtido == null
            : Math.abs(esperado - obtido) <= CENTAVO;
        if (!iguais) {
          ruins.push(`${chave}: antigo=${esperado} motor=${obtido}`);
          divergencias++;
        }
      }
      const marca = ruins.length === 0 ? "✓" : "✗";
      console.log(
        `${marca} ${period.label}  faturamento ${fmt(M.faturamentoTotal)} · recebido ${fmt(M.recebido)} · ativos ${ativos}`
      );
      for (const r of ruins) console.log(`    ${r}`);
    }
  });

  console.log(`\n${comparacoes} comparações · ${divergencias} divergência(s)`);
  await prisma.$disconnect();
  process.exit(divergencias === 0 ? 0 : 1);
}

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
