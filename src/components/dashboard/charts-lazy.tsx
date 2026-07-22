"use client";
import dynamic from "next/dynamic";

/**
 * Carregamento sob demanda dos gráficos (recharts ≈ 90–100 KB gz).
 * Os componentes já só renderizam após o mount (ClientOnly), então o
 * ssr:false não muda o visual — apenas tira o recharts do bundle inicial
 * da rota. Importe os gráficos DAQUI nas páginas server.
 */
export const MainChart = dynamic(
  () => import("./main-chart").then((m) => m.MainChart),
  { ssr: false }
);

export const CompositionDonut = dynamic(
  () => import("./composition-donut").then((m) => m.CompositionDonut),
  { ssr: false }
);
