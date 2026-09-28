/**
 * TELEFONE DO WHATSAPP → identificador canônico (E.164 só com dígitos, sem "+").
 *
 *  · tira tudo que não é dígito ("+55 (71) 99999-0000" → "5571999990000");
 *  · com "+" (ou "00") o código do país JÁ está no número ("+1 415 555 0100"
 *    → "14155550100"); SEM ele, 10 ou 11 dígitos = número brasileiro com DDD
 *    → prefixa 55. (11 dígitos sozinhos são ambíguos: o "+" decide.)
 *  · aceita de 10 a 15 dígitos (limite do E.164), primeiro dígito ≠ 0.
 *
 * O NONO DÍGITO (Brasil): a Meta às vezes entrega o `wa_id` de um celular
 * brasileiro SEM o 9 depois do DDD (55 71 9999-0000) mesmo quando ele foi
 * cadastrado com o 9 (55 71 99999-0000), e vice-versa. `variantesDoNumero`
 * devolve as duas formas para a busca — o vínculo continua sendo UM só.
 */

export function normalizarWhatsApp(raw: string | null | undefined): string | null {
  const texto = String(raw ?? "").trim();
  let d = texto.replace(/\D/g, "");
  let comPais = texto.startsWith("+");
  if (d.startsWith("00")) {
    d = d.slice(2); // discagem internacional
    comPais = true;
  }
  if (!comPais && (d.length === 10 || d.length === 11)) d = "55" + d;
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}

export function variantesDoNumero(e164: string): string[] {
  const out = new Set([e164]);
  const br = /^55(\d{2})(\d{8,9})$/.exec(e164);
  if (br) {
    const [, ddd, assinante] = br;
    if (assinante.length === 9 && assinante.startsWith("9")) out.add(`55${ddd}${assinante.slice(1)}`);
    if (assinante.length === 8 && /^[6-9]/.test(assinante)) out.add(`55${ddd}9${assinante}`);
  }
  return [...out];
}

/** Para exibir e registrar sem expor o número inteiro: 55 71 •••••-0000. */
export function mascararTelefone(e164: string | null | undefined): string {
  if (!e164) return "—";
  return `${e164.slice(0, 4)}•••••${e164.slice(-4)}`;
}

/** Formato legível para a tela do administrador: +55 (71) 99999-0000. */
export function formatarTelefone(e164: string): string {
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : `+${e164}`;
}
