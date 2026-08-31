import { addMonthsClamped } from "@/lib/financial/due-date";

/**
 * PARCELAMENTO DE TCV (F1.7 · ref. 01 §3.7).
 *
 * "Arredondamento: residual na última parcela (R$ 1.000 em 3x = 333,33 +
 * 333,33 + 333,34)."
 *
 * Função PURA de propósito: é aritmética de dinheiro, a parte que erra
 * silenciosamente. Separada do banco, ela pode ser exercitada com dezenas
 * de valores em milissegundos — e o teste que importa é sempre o mesmo:
 * a soma das parcelas tem de dar EXATAMENTE o total, em qualquer número
 * de parcelas.
 *
 * Por que o residual vai na ÚLTIMA e não na primeira: o cliente confere a
 * primeira parcela contra o que combinou. Um centavo a mais logo na
 * entrada gera ligação; um centavo na última, meses depois, passa como o
 * acerto que é.
 */

export type Parcela = {
  numero: number;
  amount: number;
  competenceYear: number;
  competenceMonth: number;
  dueDate: Date;
};

export function splitTcv(
  total: number,
  parcelas: number,
  primeiroVencimento: Date,
  primeiraCompetencia: { year: number; month: number }
): Parcela[] {
  if (!Number.isInteger(parcelas) || parcelas < 1)
    throw new Error("Número de parcelas inválido.");
  if (!(total > 0)) throw new Error("Valor total deve ser positivo.");

  // Em CENTAVOS: dividir reais em ponto flutuante é como o centavo some.
  const centavosTotal = Math.round(total * 100);
  const base = Math.floor(centavosTotal / parcelas);
  const residual = centavosTotal - base * parcelas;

  const out: Parcela[] = [];
  for (let i = 0; i < parcelas; i++) {
    const ultima = i === parcelas - 1;
    const centavos = ultima ? base + residual : base;
    const d = new Date(
      primeiraCompetencia.year,
      primeiraCompetencia.month - 1 + i,
      1
    );
    out.push({
      numero: i + 1,
      amount: centavos / 100,
      competenceYear: d.getFullYear(),
      competenceMonth: d.getMonth() + 1,
      dueDate: addMonthsClamped(primeiroVencimento, i),
    });
  }
  return out;
}
