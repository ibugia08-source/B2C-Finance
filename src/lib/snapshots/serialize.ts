import { createHash } from "crypto";

/**
 * SERIALIZAÇÃO DETERMINÍSTICA (F2.3 · ref. 01 §5.4).
 *
 * "Serialização determinística" não é preciosismo: o checksum só serve para
 * alguma coisa se a MESMA realidade produzir SEMPRE os mesmos bytes. Três
 * coisas quebram isso silenciosamente em JavaScript:
 *
 *   1. ORDEM DAS CHAVES — JSON.stringify preserva a ordem de inserção, e essa
 *      ordem muda conforme o caminho do código que montou o objeto. Aqui as
 *      chaves são ordenadas sempre.
 *   2. NÚMERO DE PONTO FLUTUANTE — 0.1 + 0.2 dá 0.30000000000000004. Dinheiro
 *      vira string com duas casas; o resto é arredondado a seis.
 *   3. DATA — o fuso do servidor entra no texto. Tudo vira ISO em UTC.
 *
 * Sem essas três, o job de integridade acusaria divergência todo dia sem que
 * nada tivesse mudado, e em uma semana ninguém mais olharia o alerta.
 */

/** Valor pronto para o checksum: chaves ordenadas, números estáveis. */
export function canonical(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "bigint") return valor.toString();
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    // Seis casas: acima disso é ruído de ponto flutuante, não informação.
    return Number(valor.toFixed(6));
  }
  if (Array.isArray(valor)) return valor.map(canonical);
  if (typeof valor === "object") {
    // Decimal do Prisma e afins: têm toFixed, não são objeto simples.
    const o = valor as Record<string, unknown>;
    if (typeof (o as any).toFixed === "function") return Number((o as any).toFixed(2));
    const saida: Record<string, unknown> = {};
    for (const chave of Object.keys(o).sort()) saida[chave] = canonical(o[chave]);
    return saida;
  }
  return valor;
}

export function canonicalJson(valor: unknown): string {
  return JSON.stringify(canonical(valor));
}

export function checksumOf(valor: unknown): string {
  return createHash("sha256").update(canonicalJson(valor)).digest("hex");
}

/**
 * Checksum por área E o total.
 *
 * O total NÃO é o hash do objeto inteiro: é o hash da lista ordenada de
 * "área:checksum". Assim, acrescentar uma área nova no futuro muda o total
 * de forma explicável, e conferir área a área continua barato — que é o que
 * transforma "algo mudou no mês" em "a carteira mudou e o resto não".
 */
export function checksumByArea(areas: Record<string, unknown>): {
  porArea: Record<string, string>;
  total: string;
} {
  const porArea: Record<string, string> = {};
  for (const nome of Object.keys(areas).sort()) porArea[nome] = checksumOf(areas[nome]);
  const total = createHash("sha256")
    .update(Object.entries(porArea).map(([k, v]) => `${k}:${v}`).join("|"))
    .digest("hex");
  return { porArea, total };
}

/** Dinheiro com duas casas, como texto — não perde centavo na comparação. */
export function money(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}
