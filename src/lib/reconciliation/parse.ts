import { createHash } from "crypto";

/**
 * LEITURA DE EXTRATO (F3.5 · ref. 01 §4.7; 02 §4.4).
 *
 * Módulo PURO: recebe texto, devolve linhas. Sem banco, sem Prisma, sem
 * upload — assim dá para exercitar com o arquivo de cada banco em teste, que
 * é onde este código vai realmente falhar. Extrato é o formato mais sujo que
 * entra no sistema: cada banco escreve OFX de um jeito, e o CSV muda de
 * coluna sem avisar.
 *
 * O QUE NUNCA ACONTECE AQUI: inventar valor. Linha que não dá para ler vira
 * ERRO com o número da linha, nunca uma transação de R$ 0,00 — uma linha
 * fantasma no extrato faz a conciliação acusar diferença para sempre.
 */

export type LinhaDeExtrato = {
  /** Ordem no arquivo, para a mensagem de erro apontar o lugar certo. */
  linha: number;
  postedAt: Date;
  /** Sinal do BANCO: positivo entrou, negativo saiu. */
  amount: number;
  description: string;
  externalId: string | null;
  balanceAfter: number | null;
};

export type ExtratoLido = {
  formato: "OFX" | "CSV";
  linhas: LinhaDeExtrato[];
  erros: { linha: number; erro: string }[];
  periodStart: Date | null;
  periodEnd: Date | null;
  openingBalance: number | null;
  closingBalance: number | null;
};

/**
 * Identidade de uma linha do extrato, para não importar a mesma duas vezes.
 *
 * Usa o FITID quando o banco fornece (é o identificador de verdade) e, quando
 * não fornece, o conjunto conta+data+valor+descrição. Duas compras idênticas
 * no mesmo dia, no mesmo valor e com a mesma descrição colidem — e isso é
 * DELIBERADO: sem identificador do banco, não existe informação que as
 * separe, e adivinhar criaria movimento que o banco não tem.
 */
export function hashDaLinha(
  accountId: string,
  l: { postedAt: Date; amount: number; description: string; externalId?: string | null }
): string {
  const base = l.externalId
    ? `${accountId}|fitid|${l.externalId}`
    : [
        accountId,
        l.postedAt.toISOString().slice(0, 10),
        l.amount.toFixed(2),
        l.description.trim().toLowerCase().replace(/\s+/g, " "),
      ].join("|");
  return createHash("sha1").update(base).digest("hex");
}

// ---------------------------------------------------------------------------
// OFX
// ---------------------------------------------------------------------------

/** `20260815120000[-3:BRT]` → Date. O fuso do sufixo é ignorado de propósito:
 *  o que importa é o DIA em que o banco lançou. */
function dataOfx(v: string): Date | null {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function tag(bloco: string, nome: string): string | null {
  // OFX 1.x é SGML: a tag pode não ter fechamento. Pega até o próximo "<"
  // ou fim de linha, que é como todo parser de OFX real funciona.
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : null;
}

export function lerOfx(texto: string): ExtratoLido {
  const linhas: LinhaDeExtrato[] = [];
  const erros: ExtratoLido["erros"] = [];

  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  blocos.forEach((bruto, i) => {
    const bloco = bruto.split(/<\/STMTTRN>/i)[0];
    const numero = i + 1;
    const data = dataOfx(tag(bloco, "DTPOSTED") ?? "");
    const valorTexto = tag(bloco, "TRNAMT");
    const valor = valorTexto == null ? NaN : Number(valorTexto.replace(",", "."));

    if (!data) {
      erros.push({ linha: numero, erro: "Movimento sem data legível (DTPOSTED)." });
      return;
    }
    if (!Number.isFinite(valor) || valor === 0) {
      erros.push({ linha: numero, erro: "Movimento sem valor legível (TRNAMT)." });
      return;
    }
    const descricao =
      tag(bloco, "MEMO") || tag(bloco, "NAME") || tag(bloco, "TRNTYPE") || "Movimento";
    linhas.push({
      linha: numero,
      postedAt: data,
      amount: Math.round(valor * 100) / 100,
      description: descricao,
      externalId: tag(bloco, "FITID"),
      balanceAfter: null,
    });
  });

  const inicio = dataOfx(tag(texto, "DTSTART") ?? "");
  const fim = dataOfx(tag(texto, "DTEND") ?? "");
  const saldoFinal = tag(texto, "BALAMT");

  return {
    formato: "OFX",
    linhas,
    erros,
    periodStart: inicio ?? menorData(linhas),
    periodEnd: fim ?? maiorData(linhas),
    openingBalance: null,
    closingBalance: saldoFinal ? Number(saldoFinal.replace(",", ".")) : null,
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const CABECALHOS = {
  data: ["data", "date", "data lançamento", "data lancamento", "dt", "data mov"],
  descricao: ["descricao", "descrição", "historico", "histórico", "description", "memo", "lançamento", "lancamento"],
  valor: ["valor", "amount", "value", "vlr"],
  saldo: ["saldo", "balance", "saldo após", "saldo apos"],
};

function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function acharColuna(cabecalho: string[], nomes: string[]): number {
  const alvo = nomes.map(normalizar);
  return cabecalho.findIndex((c) => alvo.includes(normalizar(c)));
}

/** Separa uma linha de CSV respeitando aspas. */
function celulas(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "";
  let dentro = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentro && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else dentro = !dentro;
    } else if (c === sep && !dentro) {
      out.push(atual);
      atual = "";
    } else atual += c;
  }
  out.push(atual);
  return out.map((c) => c.trim());
}

/**
 * `1.234,56` e `1,234.56` são o MESMO número escrito por dois bancos.
 * Decide pelo último separador — é o que distingue os dois sem chute.
 */
export function valorBr(v: string): number {
  const limpo = v.replace(/[R$\s ]/g, "").replace(/^\+/, "");
  if (!limpo) return NaN;
  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");
  let normal = limpo;
  if (ultimaVirgula > ultimoPonto) normal = limpo.replace(/\./g, "").replace(",", ".");
  else if (ultimoPonto > ultimaVirgula) normal = limpo.replace(/,/g, "");
  else normal = limpo.replace(",", ".");
  return Number(normal);
}

/** `15/08/2026`, `2026-08-15` e `15-08-2026`. */
export function dataBr(v: string): Date | null {
  const t = v.trim();
  let m = t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

export function lerCsv(texto: string): ExtratoLido {
  const cruas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const erros: ExtratoLido["erros"] = [];
  if (cruas.length < 2)
    return { formato: "CSV", linhas: [], erros: [{ linha: 0, erro: "Arquivo vazio." }],
      periodStart: null, periodEnd: null, openingBalance: null, closingBalance: null };

  const sep = (cruas[0].match(/;/g)?.length ?? 0) >= (cruas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const cabecalho = celulas(cruas[0], sep);
  const iData = acharColuna(cabecalho, CABECALHOS.data);
  const iDesc = acharColuna(cabecalho, CABECALHOS.descricao);
  const iValor = acharColuna(cabecalho, CABECALHOS.valor);
  const iSaldo = acharColuna(cabecalho, CABECALHOS.saldo);

  if (iData < 0 || iValor < 0) {
    return {
      formato: "CSV",
      linhas: [],
      erros: [
        {
          linha: 1,
          erro: "O arquivo precisa de uma coluna de data e uma de valor. Encontrei: " +
            cabecalho.join(", "),
        },
      ],
      periodStart: null, periodEnd: null, openingBalance: null, closingBalance: null,
    };
  }

  const linhas: LinhaDeExtrato[] = [];
  for (let i = 1; i < cruas.length; i++) {
    const c = celulas(cruas[i], sep);
    const numero = i + 1;
    const data = dataBr(c[iData] ?? "");
    const valor = valorBr(c[iValor] ?? "");
    if (!data) {
      erros.push({ linha: numero, erro: `Data não reconhecida: “${c[iData] ?? ""}”.` });
      continue;
    }
    if (!Number.isFinite(valor) || valor === 0) {
      erros.push({ linha: numero, erro: `Valor não reconhecido: “${c[iValor] ?? ""}”.` });
      continue;
    }
    const saldo = iSaldo >= 0 ? valorBr(c[iSaldo] ?? "") : NaN;
    linhas.push({
      linha: numero,
      postedAt: data,
      amount: Math.round(valor * 100) / 100,
      description: (iDesc >= 0 ? c[iDesc] : "") || "Movimento",
      externalId: null,
      balanceAfter: Number.isFinite(saldo) ? saldo : null,
    });
  }

  const ultima = linhas[linhas.length - 1];
  return {
    formato: "CSV",
    linhas,
    erros,
    periodStart: menorData(linhas),
    periodEnd: maiorData(linhas),
    openingBalance: null,
    closingBalance: ultima?.balanceAfter ?? null,
  };
}

function menorData(l: LinhaDeExtrato[]): Date | null {
  return l.length ? new Date(Math.min(...l.map((x) => x.postedAt.getTime()))) : null;
}
function maiorData(l: LinhaDeExtrato[]): Date | null {
  return l.length ? new Date(Math.max(...l.map((x) => x.postedAt.getTime()))) : null;
}

/** Escolhe o leitor pelo CONTEÚDO, não pela extensão do arquivo. */
export function lerExtrato(texto: string): ExtratoLido {
  return /<OFX|<STMTTRN/i.test(texto) ? lerOfx(texto) : lerCsv(texto);
}
