/**
 * Rótulo curto de um dia: "2026-09-22" → "22/09".
 *
 * Mora num módulo PRÓPRIO, sem "use client", porque é usado dos dois lados —
 * o servidor monta a série e o gráfico casa o ponto do primeiro dia negativo
 * com o rótulo do eixo. Exportar utilitário de dentro de um arquivo
 * "use client" não funciona: no servidor o export vira referência de
 * componente, e a chamada estoura em tempo de execução (não na compilação).
 */
export function rotuloDoDia(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}
