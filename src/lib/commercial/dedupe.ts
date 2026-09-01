/**
 * DEDUPLICAÇÃO DE LEAD × CLIENTE (F4.1 · ref. 01 §4.6).
 *
 * "Conversão deduplica por documento; nome/telefone parecidos geram SUGESTÃO
 * HUMANA; churnado reativa sem duplicar."
 *
 * A frase da spec tem três níveis e a diferença entre eles é a regra inteira:
 *
 *  · DOCUMENTO é identidade. Mesmo CNPJ é o mesmo cliente, ponto — o sistema
 *    liga sozinho e não pergunta.
 *  · NOME e TELEFONE são PISTA. "Padaria do Bairro" e "Padaria do Bairro
 *    LTDA" provavelmente são a mesma empresa; "Auto Center Silva" e "Auto
 *    Center Silva Filho" provavelmente NÃO são. Nenhum algoritmo decide isso
 *    bem, e decidir errado funde dois clientes de verdade — o dano mais caro
 *    e mais difícil de desfazer da carteira. Então vira sugestão, e uma
 *    pessoa escolhe.
 *  · CHURNADO não é impedimento: o cliente volta na mesma ficha, com o
 *    histórico inteiro, em vez de nascer de novo sem passado.
 *
 * Módulo PURO — a comparação é exercitada com dezenas de pares em teste, que
 * é a única forma de calibrar "parecido" sem ir apertando parafuso no escuro.
 */

/** Só os dígitos. `null` quando não sobra nada. */
export function apenasDigitos(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length > 0 ? d : null;
}

/**
 * CPF (11) e CNPJ (14) são os tamanhos válidos. Outro tamanho é digitação
 * incompleta, e comparar por ela casaria empresas sem nenhuma relação.
 */
export function documentoValido(digitos: string | null): boolean {
  return digitos !== null && (digitos.length === 11 || digitos.length === 14);
}

const RUIDO_DE_RAZAO_SOCIAL = [
  "ltda", "me", "epp", "eireli", "sa", "s a", "mei", "cia", "e cia",
  "comercio", "comercial", "servicos", "industria", "do brasil",
];

/** Nome comparável: sem acento, sem pontuação, sem sufixo de razão social. */
export function nomeComparavel(v: string): string {
  const base = v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const palavras = base.split(" ").filter((p) => p && !RUIDO_DE_RAZAO_SOCIAL.includes(p));
  return palavras.join(" ");
}

/**
 * Telefone comparável: os 8 últimos dígitos.
 *
 * Oito e não nove nem onze: o mesmo número aparece com e sem DDD, com e sem
 * o 9 na frente, com e sem +55. Os oito finais sobrevivem a todas essas
 * formas — e colidir dois telefones diferentes nos oito finais é raro o
 * bastante para virar SUGESTÃO, nunca ligação automática.
 */
export function telefoneComparavel(v: string | null | undefined): string | null {
  const d = apenasDigitos(v);
  return d && d.length >= 8 ? d.slice(-8) : null;
}

/** Distância de Levenshtein — pequena, direta, suficiente para nomes curtos. */
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    anterior = atual;
  }
  return anterior[b.length];
}

export type Semelhanca = {
  /** 0 a 100. */
  score: number;
  motivo: string;
};

/**
 * Quanto dois cadastros se parecem. NUNCA decide nada — só ordena a lista
 * que uma pessoa vai olhar.
 */
export function semelhanca(
  a: { nome: string; telefone?: string | null },
  b: { nome: string; telefone?: string | null }
): Semelhanca | null {
  const telA = telefoneComparavel(a.telefone);
  const telB = telefoneComparavel(b.telefone);
  if (telA && telB && telA === telB) {
    return { score: 95, motivo: "mesmo telefone" };
  }

  const nomeA = nomeComparavel(a.nome);
  const nomeB = nomeComparavel(b.nome);
  if (!nomeA || !nomeB) return null;
  if (nomeA === nomeB) return { score: 90, motivo: "mesmo nome" };

  const maior = Math.max(nomeA.length, nomeB.length);
  const proximidade = 1 - distancia(nomeA, nomeB) / maior;
  // 0,82 foi calibrado nos casos do teste: pega "padaria do bairro" ×
  // "padaria do bairro ltda" e NÃO pega "auto center silva" × "auto center
  // silva filho", que são empresas diferentes de donos da mesma família.
  if (proximidade >= 0.82) {
    return { score: Math.round(proximidade * 85), motivo: "nome muito parecido" };
  }
  return null;
}
