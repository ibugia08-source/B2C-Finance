/**
 * OBSERVABILIDADE (T7 · ref. 03 §4.6, §4.7).
 *
 * Três peças, nenhuma dependendo de infraestrutura externa:
 *
 *  1. CORRELATION ID por requisição — o middleware carimba, o contexto dos
 *     motores lê, o AuditLog grava. A pergunta de suporte "o que aconteceu
 *     nesse clique?" vira um grep por um id.
 *  2. DURAÇÃO — `medir(chave, fn)` cronometra páginas e ações e guarda a
 *     amostra num anel EM MEMÓRIA DO PROCESSO. É a realidade honesta deste
 *     deploy (uma instância): reiniciou, zera — e a tela diz isso.
 *  3. P95 CONTRA ORÇAMENTO — os tetos de 03 §4.7 declarados por chave. O
 *     lado servidor é PARTE do orçamento (LCP inclui rede e navegador);
 *     estourar aqui já garante o estouro lá, então o alerta é conservador
 *     no sentido certo.
 *
 * PII fora: as amostras guardam CHAVE e MILISSEGUNDOS, nunca dados.
 */

const TAMANHO_DO_ANEL = 500;

type Anel = { amostras: number[]; idx: number; total: number };
const aneis = new Map<string, Anel>();

/** Orçamentos de 03 §4.7 que têm medição do lado servidor (proxy declarado). */
export const ORCAMENTOS_MS: Record<string, number> = {
  "page:dashboard": 1500, // LCP das telas de trabalho ≤ 1,5s
  "page:cobrancas": 2500, // Gestão do Mês interativa ≤ 2,5s
  "page:fila": 400, // item do Modo Fila (lado sistema) ≤ 400ms
  "page:clientes": 1500,
  "action:fila.enviar": 400,
  "action:fila.marcar-enviada": 400,
};

export function registrarMedicao(chave: string, ms: number): void {
  let anel = aneis.get(chave);
  if (!anel) {
    anel = { amostras: new Array(TAMANHO_DO_ANEL), idx: 0, total: 0 };
    aneis.set(chave, anel);
  }
  anel.amostras[anel.idx] = ms;
  anel.idx = (anel.idx + 1) % TAMANHO_DO_ANEL;
  anel.total += 1;
}

/** Cronometra qualquer trecho async e registra — nunca engole o erro. */
export async function medir<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const inicio = performance.now();
  try {
    return await fn();
  } finally {
    registrarMedicao(chave, Math.round(performance.now() - inicio));
  }
}

export type ResumoDeChave = {
  chave: string;
  amostras: number;
  p50: number;
  p95: number;
  max: number;
  orcamentoMs: number | null;
  estourado: boolean;
};

function percentil(ordenadas: number[], p: number): number {
  if (ordenadas.length === 0) return 0;
  const i = Math.min(ordenadas.length - 1, Math.ceil((p / 100) * ordenadas.length) - 1);
  return ordenadas[Math.max(0, i)];
}

export function resumoDeMedicoes(): ResumoDeChave[] {
  const out: ResumoDeChave[] = [];
  for (const [chave, anel] of aneis) {
    const validas = anel.amostras.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
    if (validas.length === 0) continue;
    const orcamento = ORCAMENTOS_MS[chave] ?? null;
    const p95 = percentil(validas, 95);
    out.push({
      chave,
      amostras: Math.min(anel.total, TAMANHO_DO_ANEL),
      p50: percentil(validas, 50),
      p95,
      max: validas[validas.length - 1],
      orcamentoMs: orcamento,
      // Alerta só com amostra suficiente: p95 de 3 medições é ruído.
      estourado: orcamento != null && validas.length >= 20 && p95 > orcamento,
    });
  }
  return out.sort((a, b) => a.chave.localeCompare(b.chave));
}

/** Só para teste. */
export function zerarMedicoes(): void {
  aneis.clear();
}
