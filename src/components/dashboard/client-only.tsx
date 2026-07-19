"use client";
import { useEffect, useState } from "react";

/**
 * Renderiza os filhos apenas no cliente (após montar). Usado para envolver
 * gráficos Recharts, que não devem ser renderizados no SSR do App Router
 * (evita exceção no servidor). Mostra um placeholder com a altura reservada
 * para não causar salto de layout.
 */
export function ClientOnly({
  children,
  height = 280,
}: {
  children: React.ReactNode;
  height?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div style={{ height }} className="w-full animate-pulse rounded-md bg-muted/40" />;
  }
  return <>{children}</>;
}
