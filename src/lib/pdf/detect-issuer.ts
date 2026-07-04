/**
 * Detecta o banco/emissor de uma fatura a partir do texto extraído do PDF.
 * O `label` segue a convenção usada no campo `bank` do CreditCard, para
 * permitir o casamento automático com os cartões cadastrados.
 */
export type DetectedIssuer = { key: string; label: string };

const ISSUERS: { key: string; label: string; re: RegExp }[] = [
  { key: "nubank", label: "Nubank", re: /nubank|nu pagamentos|nu financeira/i },
  { key: "inter", label: "Inter", re: /banco inter|\binter\b/i },
  { key: "c6", label: "C6", re: /c6\s*bank|banco c6|\bc6\b/i },
  { key: "will", label: "Will Bank", re: /will\s*bank/i },
  { key: "itau", label: "Itaú", re: /ita[uú]|itaucard|itaú unibanco/i },
  { key: "picpay", label: "PicPay", re: /picpay/i },
  { key: "sicredi", label: "Sicredi", re: /sicredi/i },
  { key: "bradesco", label: "Bradesco", re: /bradesco/i },
  { key: "santander", label: "Santander", re: /santander/i },
  { key: "caixa", label: "Caixa", re: /caixa econ[oô]mica|caixa econômica/i },
  { key: "bb", label: "Banco do Brasil", re: /banco do brasil|\bourocard\b/i },
  { key: "original", label: "Banco Original", re: /banco original/i },
  { key: "next", label: "Next", re: /\bnext\b/i },
  { key: "neon", label: "Neon", re: /\bneon\b/i },
  { key: "xp", label: "XP", re: /\bxp\b|xpinc|xp investimentos/i },
  { key: "btg", label: "BTG", re: /\bbtg\b|btg pactual/i },
  { key: "ame", label: "Ame", re: /\bame digital\b/i },
];

/**
 * Retorna o emissor detectado (o primeiro que casar pela ordem de prioridade
 * acima). Olha apenas o cabeçalho do documento (primeiras ~60 linhas), onde o
 * nome do banco costuma aparecer, para evitar falsos positivos de nomes de
 * estabelecimentos no corpo da fatura.
 */
export function detectIssuer(text: string): DetectedIssuer | null {
  const head = text
    .split(/\r?\n/)
    .slice(0, 60)
    .join("\n");
  for (const issuer of ISSUERS) {
    if (issuer.re.test(head)) {
      return { key: issuer.key, label: issuer.label };
    }
  }
  // fallback: procura no texto inteiro
  for (const issuer of ISSUERS) {
    if (issuer.re.test(text)) {
      return { key: issuer.key, label: issuer.label };
    }
  }
  return null;
}

/** Normaliza para comparar `bank` do cartão com o label detectado. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+bank\b/g, "")
    .replace(/banco\s+/g, "")
    .trim();
}

/**
 * Dado o emissor detectado e a lista de cartões, retorna os cartões cujo banco
 * casa com o emissor. Match flexível: igualdade ou inclusão em qualquer direção.
 */
export function matchCardsByIssuer<T extends { bank?: string | null }>(
  issuer: DetectedIssuer | null,
  cards: T[]
): T[] {
  if (!issuer) return [];
  const target = norm(issuer.label);
  return cards.filter((c) => {
    if (!c.bank) return false;
    const b = norm(c.bank);
    return b === target || b.includes(target) || target.includes(b);
  });
}
