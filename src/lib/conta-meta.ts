/**
 * Metadados de conta bancária — vocabulário controlado (DS-13).
 *
 * Mora FORA de lib/actions/contas.ts porque aquele arquivo é "use server", e
 * um módulo de server actions só pode exportar função assíncrona: exportar
 * esta constante de lá compila, passa no lint e no teste, e quebra no build
 * ("A 'use server' file can only export async functions").
 *
 * A lista é fechada de propósito. Campo de texto livre para classificação foi
 * o que produziu "Imobiliária" e "IMOBILIÁRIA" convivendo no cadastro de
 * clientes, que a auditoria de 11/09/2026 registrou.
 */
export const TIPOS_DE_CONTA = [
  { valor: "corrente", label: "Conta corrente" },
  { valor: "poupanca", label: "Poupança" },
  { valor: "dinheiro", label: "Dinheiro em espécie" },
  { valor: "investimento", label: "Investimento" },
] as const;

export type TipoDeConta = (typeof TIPOS_DE_CONTA)[number]["valor"];

export const TIPO_DE_CONTA_LABEL: Record<string, string> = Object.fromEntries(
  TIPOS_DE_CONTA.map((t) => [t.valor, t.label])
);
