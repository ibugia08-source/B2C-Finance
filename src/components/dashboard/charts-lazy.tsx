"use client";
import dynamic from "next/dynamic";

/**
 * Carregamento sob demanda dos gráficos (recharts ≈ 90–100 KB gz).
 * Os componentes já só renderizam após o mount (ClientOnly), então o
 * ssr:false não muda o visual — apenas tira o recharts do bundle inicial
 * da rota. Importe os gráficos DAQUI nas páginas server.
 */
export const CompositionDonut = dynamic(
  () => import("./composition-donut").then((m) => m.CompositionDonut),
  { ssr: false }
);

export const RenewalsChart = dynamic(
  () => import("./renewals-chart").then((m) => m.RenewalsChart),
  { ssr: false }
);

export const MrrTcvChart = dynamic(
  () => import("./evolution-charts").then((m) => m.MrrTcvChart),
  { ssr: false }
);

export const ClientsYearChart = dynamic(
  () => import("./evolution-charts").then((m) => m.ClientsYearChart),
  { ssr: false }
);

export const ChurnYearChart = dynamic(
  () => import("./evolution-charts").then((m) => m.ChurnYearChart),
  { ssr: false }
);

export const TicketYearChart = dynamic(
  () => import("./evolution-charts").then((m) => m.TicketYearChart),
  { ssr: false }
);
