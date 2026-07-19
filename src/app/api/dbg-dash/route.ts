import { NextResponse } from "next/server";
import { resolvePeriod } from "@/lib/period";

/**
 * TEMPORÁRIO — diagnóstico do Dashboard em produção. Sem dados sensíveis:
 * apenas roda cada função da camada e reporta ok/erro. Protegido por token.
 * REMOVER após diagnosticar.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  if (token !== "b2c-diag-9c74489") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const period = resolvePeriod({});
  const y = period.start.getFullYear();
  const m = period.start.getMonth() + 1;
  const results: Record<string, string> = {};

  async function run(name: string, fn: () => Promise<any>) {
    try {
      const r = await fn();
      results[name] = "OK" + (Array.isArray(r) ? ` (${r.length})` : "");
    } catch (e: any) {
      results[name] = "FAIL: " + String(e?.message ?? e).slice(0, 300);
    }
  }

  const dm = await import("@/lib/services/dashboard-main");
  const em = await import("@/lib/services/dashboard-metrics");

  await run("getExecutiveDashboard", () => em.getExecutiveDashboard({ period } as any));
  await run("getDashboardMainMetrics", () => dm.getDashboardMainMetrics(period));
  await run("getYearlySeries", () => dm.getYearlySeries(y));
  await run("getOpenByClient", () => dm.getOpenByClient(period));
  await run("getReceivedDetail", () => dm.getReceivedDetail(period));
  await run("getExpensesDetail", () => dm.getExpensesDetail(period));
  await run("getExpensesByCategory", () => dm.getExpensesByCategory(period));
  await run("getMrrClientsDetail", () => dm.getMrrClientsDetail());
  await run("getTcvClientsDetail", () => dm.getTcvClientsDetail(period));
  await run("getNewClientsDetail", () => dm.getNewClientsDetail(period));
  await run("getRenewalClientsDetail", () => dm.getRenewalClientsDetail(m));
  await run("getResultLaunchedForMonth", () => dm.getResultLaunchedForMonth(y, m));

  // Todas juntas (reproduz o fan-out do page.tsx)
  try {
    await Promise.all([
      em.getExecutiveDashboard({ period } as any),
      dm.getDashboardMainMetrics(period),
      dm.getYearlySeries(y),
      dm.getOpenByClient(period),
      dm.getReceivedDetail(period),
      dm.getExpensesDetail(period),
      dm.getExpensesByCategory(period),
      dm.getMrrClientsDetail(),
      dm.getTcvClientsDetail(period),
      dm.getNewClientsDetail(period),
      dm.getRenewalClientsDetail(m),
    ]);
    results["ALL_PARALLEL"] = "OK";
  } catch (e: any) {
    results["ALL_PARALLEL"] = "FAIL: " + String(e?.message ?? e).slice(0, 300);
  }

  return NextResponse.json({ period: period.label, results });
}
