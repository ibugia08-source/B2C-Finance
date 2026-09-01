/**
 * ARITMÉTICA DO RATEIO (F3.4 · ref. 01 §3.14).
 *
 * "Rateio soma exatamente a origem; residual determinístico (última linha ou
 * maior peso)."
 *
 * Módulo PURO, sem banco e sem Prisma, pelo mesmo motivo de `splitTcv`: é a
 * parte que erra em silêncio. Distribuir R$ 1.000 entre 3 clientes em ponto
 * flutuante devolve 333,33 três vezes — e some um centavo do resultado da
 * empresa que ninguém vai procurar num rateio.
 *
 * A escolha do RESIDUAL, escrita aqui porque é decisão e não detalhe: ele vai
 * para o MAIOR PESO, e empate é decidido pela ÚLTIMA linha. Nas duas pontas
 * isso é o menos visível possível — no maior peso o centavo é a menor
 * distorção relativa, e num rateio igualitário cair na última linha é a mesma
 * convenção que o parcelamento de TCV já usa. O que não pode acontecer é o
 * residual mudar de lugar entre duas execuções: aí o mesmo rateio recalculado
 * amanhã dá outro número, e a fotografia do mês passa a divergir sozinha.
 */

export type Peso = {
  /** Identificador da dimensão que recebe a fatia (cliente, agência, serviço). */
  id: string;
  /** Peso relativo. Zero é permitido; negativo não. */
  peso: number;
};

export type Fatia = {
  id: string;
  amount: number;
  /** Percentual efetivo da origem, com 6 casas (01 §3.14: taxas em Decimal(9,6)). */
  percentage: number;
};

function centavos(v: number): number {
  return Math.round(v * 100);
}

/**
 * Distribui `total` entre os pesos. A soma das fatias é EXATAMENTE `total`.
 *
 * Pesos todos zerados caem no rateio igualitário: é o que a tela faz quando
 * alguém marca cinco clientes e não digita proporção nenhuma.
 */
export function distribuirPorPeso(total: number, pesos: Peso[]): Fatia[] {
  if (pesos.length === 0) return [];
  if (!(total > 0)) throw new RangeError("O valor a ratear tem de ser positivo.");
  if (pesos.some((p) => !(p.peso >= 0)))
    throw new RangeError("Peso de rateio não pode ser negativo.");

  const somaPesos = pesos.reduce((s, p) => s + p.peso, 0);
  const usados = somaPesos > 0 ? pesos : pesos.map((p) => ({ ...p, peso: 1 }));
  const base = usados.reduce((s, p) => s + p.peso, 0);

  const totalCentavos = centavos(total);
  // Piso em cada linha: distribuir o residual DEPOIS é o que garante que a
  // soma feche. Arredondar cada linha e torcer é como o centavo se perde.
  const brutos = usados.map((p) => Math.floor((totalCentavos * p.peso) / base));
  const residual = totalCentavos - brutos.reduce((s, c) => s + c, 0);

  // Maior peso; empate fica com a ÚLTIMA linha (>= no lugar de >).
  let alvo = 0;
  for (let i = 1; i < usados.length; i++) {
    if (usados[i].peso >= usados[alvo].peso) alvo = i;
  }
  brutos[alvo] += residual;

  return usados.map((p, i) => ({
    id: p.id,
    amount: brutos[i] / 100,
    percentage: Number(((brutos[i] / totalCentavos) * 100).toFixed(6)),
  }));
}

/** Rateio igualitário — o caso mais comum na tela. */
export function distribuirIgualmente(total: number, ids: string[]): Fatia[] {
  return distribuirPorPeso(total, ids.map((id) => ({ id, peso: 1 })));
}

/**
 * Converte percentuais digitados em valores. NÃO exige somar 100: rateio
 * parcial é legítimo e o que sobra fica visível como "não alocado" — que é
 * justamente a informação que 01 §4.7 manda mostrar.
 */
export function porPercentual(
  total: number,
  linhas: { id: string; percentual: number }[]
): Fatia[] {
  return linhas.map((l) => ({
    id: l.id,
    amount: Math.round(total * l.percentual) / 100,
    percentage: Number(l.percentual.toFixed(6)),
  }));
}

/** Quanto da origem ainda não tem dono. Nunca negativo. */
export function naoAlocado(total: number, fatias: { amount: number }[]): number {
  const soma = fatias.reduce((s, f) => s + f.amount, 0);
  return Math.max(0, Math.round((total - soma) * 100) / 100);
}
