import * as XLSX from "xlsx";
import { parseDateCell, parseMoneyCell } from "@/lib/imports/engine";
import { MONTHS_PT, MONTHS_PT_SHORT } from "@/lib/format";
import { toCompetence, type Competence } from "@/lib/competence";
import {
  ABA_CLIENTES, ABA_MENSAL, ABA_RENOVACOES,
  STATUS_ATUAL, STATUS_PAGAMENTO,
} from "./modelo";
import { ESTABILIDADE, ADS_STATUS, RISCO } from "@/lib/avaliacao-meta";

/**
 * PARSER DA IMPORTAÇÃO TOTAL (F1.11 v2).
 *
 * Lê o livro inteiro e devolve linhas TIPADAS + erros POR LINHA. Nada aqui
 * toca o banco: validar é barato e gravar é caro — a prévia inteira roda em
 * cima do que sai daqui.
 *
 * Formato largo: quando não existe a aba MENSAL, o parser procura (a) abas
 * cujo NOME é uma competência (uma aba por mês) ou (b) uma aba com coluna
 * de cliente e UMA COLUNA POR MÊS, onde a célula é o status de pagamento.
 * O formato longo continua sendo o canônico; a conversão gera as mesmas
 * linhas MENSAL e aponta a aba/linha de origem para a proveniência.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type LinhaCliente = {
  sourceRow: number;
  nome: string;
  documento: string | null;   // só dígitos (chave de dedupe)
  documentoBruto: string | null;
  agencia: string | null;
  grupoEconomico: string | null;
  nicho: string | null;
  cidade: string | null;
  uf: string | null;
  canalOrigem: string | null;
  sdrOrigem: string | null;
  closerOrigem: string | null;
  dataEntrada: Date;
  modalidade: "MRR" | "TCV";
  valorMensal: number | null;
  valorTotal: number | null;
  prazoMeses: number | null;
  diaVencimento: number | null;
  servicos: string[];
  gestor1: string | null;
  gestor2: string | null;
  statusAtual: (typeof STATUS_ATUAL)[number];
  dataChurn: Date | null;
  motivoChurn: string | null;
  obs: string | null;
};

export type StatusPagamentoParseado =
  | { tipo: "PAGO" }
  | { tipo: "PAGO_COM_ATRASO" }
  | { tipo: "PAGO_EM"; ano: number; mes: number }
  | { tipo: "A_VENCER" }
  | { tipo: "VENCIDO" }
  | { tipo: "SEM_COBRANCA" }
  | { tipo: "REMOVIDO" }
  | { tipo: "PARCIAL" };

export type LinhaMensal = {
  sourceRow: number;
  sourceSheet: string;
  competencia: Competence;
  clienteRef: string;         // documento (dígitos) ou nome, como veio
  clienteRefEhDocumento: boolean;
  valorCobrado: number | null;
  status: StatusPagamentoParseado;
  statusBruto: string;
  dataPagamento: Date | null;
  valorPago: number | null;
  estabilidade: string | null;
  ads: string | null;
  risco: string | null;
  upsell: "sim" | "não" | null;
  gestor1DoMes: string | null;
  obsDoMes: string | null;
};

export type LinhaRenovacao = {
  sourceRow: number;
  clienteRef: string;
  clienteRefEhDocumento: boolean;
  data: Date;
  modalidade: "MRR" | "TCV" | null;
  valorMensal: number | null;
  valorTotal: number | null;
  prazoMeses: number | null;
  obs: string | null;
};

export type ErroDeLinha = { aba: string; linha: number; campo: string; erro: string };

export type PlanilhaTotal = {
  formato: "longo" | "largo-abas" | "largo-colunas";
  clientes: LinhaCliente[];
  mensal: LinhaMensal[];
  renovacoes: LinhaRenovacao[];
  erros: ErroDeLinha[];
  avisos: string[];
};

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "");

const chave = (s: unknown) =>
  semAcento(String(s ?? "")).toLowerCase().replace(/[\s*_-]+/g, "");

const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** CNPJ/CPF → só dígitos; menos de 11 dígitos não identifica ninguém. */
export function normalizarDocumento(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 11 ? d : null;
}

export function normalizarNomeCliente(v: unknown): string {
  return semAcento(String(v ?? "")).toLowerCase().replace(/\s+/g, " ").trim();
}

const MESES_CURTOS = MONTHS_PT_SHORT.map((m) => semAcento(m).toLowerCase());
const MESES_LONGOS = MONTHS_PT.map((m) => semAcento(m).toLowerCase());

/** Competência flexível: 2026-03 · 03/2026 · mar/2026 · MARÇO 2026 · ago/26. */
export function parseCompetenciaFlex(v: unknown): Competence | null {
  if (v instanceof Date && !isNaN(v.getTime()))
    return toCompetence(v.getFullYear(), v.getMonth() + 1);
  const s = semAcento(String(v ?? "")).toLowerCase().trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) return competenciaOuNull(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return competenciaOuNull(Number(m[2]), Number(m[1]));
  m = s.match(/^([a-z]{3,9})[\s/.-]*(?:de\s+)?(\d{2}|\d{4})$/);
  if (m) {
    const nome = m[1];
    let mes = MESES_CURTOS.indexOf(nome.slice(0, 3)) + 1;
    if (mes === 0) mes = MESES_LONGOS.indexOf(nome) + 1;
    if (mes === 0) return null;
    const anoRaw = Number(m[2]);
    const ano = anoRaw < 100 ? 2000 + anoRaw : anoRaw;
    return competenciaOuNull(ano, mes);
  }
  return null;
}

function competenciaOuNull(ano: number, mes: number): Competence | null {
  if (ano < 1990 || ano > 2100 || mes < 1 || mes > 12) return null;
  return toCompetence(ano, mes);
}

export function parseStatusPagamento(v: unknown): StatusPagamentoParseado | null {
  const s = semAcento(String(v ?? "")).toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  const pagoEm = s.match(/^pago em (\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (pagoEm) {
    const mes = Number(pagoEm[1]);
    const anoRaw = Number(pagoEm[2]);
    const ano = anoRaw < 100 ? 2000 + anoRaw : anoRaw;
    if (mes < 1 || mes > 12 || ano < 1990 || ano > 2100) return null;
    return { tipo: "PAGO_EM", ano, mes };
  }
  switch (s) {
    case "pago": return { tipo: "PAGO" };
    case "pago com atraso": return { tipo: "PAGO_COM_ATRASO" };
    case "a vencer": return { tipo: "A_VENCER" };
    case "vencido": return { tipo: "VENCIDO" };
    case "sem cobranca": return { tipo: "SEM_COBRANCA" };
    case "removido": return { tipo: "REMOVIDO" };
    case "parcial": return { tipo: "PARCIAL" };
    default: return null;
  }
}

function enumFechado<T extends readonly string[]>(
  v: unknown,
  opcoes: T
): T[number] | null {
  const s = chave(v);
  if (!s) return null;
  const idx = opcoes.findIndex((o) => chave(o) === s);
  return idx >= 0 ? opcoes[idx] : null;
}

// ---------------------------------------------------------------------------
// Leitura do livro
// ---------------------------------------------------------------------------

type Aba = { nome: string; linhas: Record<string, unknown>[] };

function lerLivro(buffer: Buffer): Aba[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return wb.SheetNames.map((nome) => ({
    nome,
    linhas: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nome], {
      defval: "",
      raw: true,
    }),
  }));
}

/** Acha a coluna pela chave normalizada ("valor_mensal" casa "Valor mensal (R$)*"). */
function coluna(linha: Record<string, unknown>, ...nomes: string[]): unknown {
  const alvo = nomes.map(chave);
  for (const [k, v] of Object.entries(linha)) {
    const ck = chave(k);
    if (alvo.some((a) => ck === a || ck.startsWith(a))) return v;
  }
  return "";
}

function achaAba(abas: Aba[], nome: string): Aba | null {
  const alvo = chave(nome);
  return abas.find((a) => chave(a.nome) === alvo) ?? null;
}

// ---------------------------------------------------------------------------
// Parse das abas canônicas
// ---------------------------------------------------------------------------

function parseClientes(aba: Aba, erros: ErroDeLinha[]): LinhaCliente[] {
  const out: LinhaCliente[] = [];
  aba.linhas.forEach((raw, i) => {
    const linha = i + 1;
    const err = (campo: string, erro: string) =>
      erros.push({ aba: aba.nome, linha, campo, erro });

    const nome = texto(coluna(raw, "nome"));
    if (!nome) {
      if (Object.values(raw).some((v) => String(v ?? "").trim() !== ""))
        err("nome", "obrigatório");
      return; // linha vazia é ignorada em silêncio
    }
    const dataEntrada = parseDateCell(coluna(raw, "data_entrada", "dataentrada"));
    if (!dataEntrada) { err("data_entrada", "data inválida (use DD/MM/AAAA)"); return; }

    const modalidade = enumFechado(coluna(raw, "modalidade"), ["MRR", "TCV"] as const);
    if (!modalidade) { err("modalidade", "use MRR ou TCV"); return; }

    const statusAtual = enumFechado(coluna(raw, "status_atual", "statusatual", "status"), STATUS_ATUAL);
    if (!statusAtual) { err("status_atual", `use ${STATUS_ATUAL.join(" | ")}`); return; }

    const valorMensal = parseMoneyCell(coluna(raw, "valor_mensal", "valormensal"));
    const valorTotal = parseMoneyCell(coluna(raw, "valor_total", "valortotal"));
    if (modalidade === "MRR" && (valorMensal ?? 0) <= 0)
      err("valor_mensal", "cliente MRR precisa de valor mensal > 0");
    if (modalidade === "TCV" && (valorTotal ?? 0) <= 0)
      err("valor_total", "cliente TCV precisa de valor total > 0");

    const diaRaw = coluna(raw, "dia_vencimento", "diavencimento");
    let diaVencimento: number | null = null;
    if (String(diaRaw ?? "").trim() !== "") {
      const d = Number(diaRaw);
      if (!Number.isInteger(d) || d < 1 || d > 31) { err("dia_vencimento", "use 1 a 31"); return; }
      diaVencimento = d;
    }

    const dataChurn = parseDateCell(coluna(raw, "data_churn", "datachurn"));
    if (statusAtual === "Churn" && !dataChurn && texto(coluna(raw, "data_churn", "datachurn")))
      err("data_churn", "data inválida");

    const prazoRaw = coluna(raw, "prazo_meses", "prazomeses");
    const prazoMeses =
      String(prazoRaw ?? "").trim() === "" ? null : Math.max(1, Math.trunc(Number(prazoRaw)) || 0) || null;

    out.push({
      sourceRow: linha,
      nome,
      documento: normalizarDocumento(coluna(raw, "documento", "cnpj", "cpf")),
      documentoBruto: texto(coluna(raw, "documento", "cnpj", "cpf")),
      agencia: texto(coluna(raw, "agencia")),
      grupoEconomico: texto(coluna(raw, "grupo_economico", "grupoeconomico")),
      nicho: texto(coluna(raw, "nicho", "segmento")),
      cidade: texto(coluna(raw, "cidade")),
      uf: texto(coluna(raw, "uf", "estado")),
      canalOrigem: texto(coluna(raw, "canal_origem", "canalorigem", "origem")),
      sdrOrigem: texto(coluna(raw, "sdr_origem", "sdrorigem")),
      closerOrigem: texto(coluna(raw, "closer_origem", "closerorigem")),
      dataEntrada,
      modalidade,
      valorMensal,
      valorTotal,
      prazoMeses,
      diaVencimento,
      servicos: String(coluna(raw, "servicos") ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
      gestor1: texto(coluna(raw, "gestor_1", "gestor1")),
      gestor2: texto(coluna(raw, "gestor_2", "gestor2")),
      statusAtual,
      dataChurn,
      motivoChurn: texto(coluna(raw, "motivo_churn", "motivochurn")),
      obs: texto(coluna(raw, "obs", "observacao", "observacoes")),
    });
  });
  return out;
}

function parseMensalLinha(
  raw: Record<string, unknown>,
  linha: number,
  abaNome: string,
  erros: ErroDeLinha[]
): LinhaMensal | null {
  const err = (campo: string, erro: string) =>
    erros.push({ aba: abaNome, linha, campo, erro });

  const clienteBruto = texto(coluna(raw, "cliente", "documento", "nome"));
  const compBruta = coluna(raw, "competencia", "mes", "competência");
  const vazia = !clienteBruto && String(compBruta ?? "").trim() === "";
  if (vazia) return null;

  const competencia = parseCompetenciaFlex(compBruta);
  if (!competencia) { err("competencia", `inválida: "${compBruta}"`); return null; }
  if (!clienteBruto) { err("cliente", "obrigatório (documento ou nome exato)"); return null; }

  const statusBruto = String(coluna(raw, "status_pagamento", "statuspagamento", "status") ?? "").trim();
  const status = parseStatusPagamento(statusBruto);
  if (!status) {
    err("status_pagamento", `"${statusBruto}" fora do vocabulário: ${STATUS_PAGAMENTO.join(" | ")}`);
    return null;
  }
  const valorPago = parseMoneyCell(coluna(raw, "valor_pago", "valorpago"));
  if (status.tipo === "PARCIAL" && (valorPago ?? 0) <= 0) {
    err("valor_pago", "Parcial exige valor_pago > 0");
    return null;
  }

  const documento = normalizarDocumento(clienteBruto);
  return {
    sourceRow: linha,
    sourceSheet: abaNome,
    competencia,
    clienteRef: documento ?? clienteBruto,
    clienteRefEhDocumento: documento != null,
    valorCobrado: parseMoneyCell(coluna(raw, "valor_cobrado", "valorcobrado", "valor")),
    status,
    statusBruto,
    dataPagamento: parseDateCell(coluna(raw, "data_pagamento", "datapagamento")),
    valorPago,
    estabilidade: enumFechado(coluna(raw, "estabilidade"), ESTABILIDADE),
    ads: enumFechado(coluna(raw, "ads"), ADS_STATUS),
    risco: enumFechado(coluna(raw, "risco"), RISCO),
    upsell: enumFechado(coluna(raw, "upsell"), ["sim", "não"] as const),
    gestor1DoMes: texto(coluna(raw, "gestor_1_do_mes", "gestor1domes", "gestor_do_mes")),
    obsDoMes: texto(coluna(raw, "obs_do_mes", "obsdomes", "obs")),
  };
}

function parseRenovacoes(aba: Aba, erros: ErroDeLinha[]): LinhaRenovacao[] {
  const out: LinhaRenovacao[] = [];
  aba.linhas.forEach((raw, i) => {
    const linha = i + 1;
    const clienteBruto = texto(coluna(raw, "cliente", "documento", "nome"));
    if (!clienteBruto) return;
    const data = parseDateCell(coluna(raw, "data"));
    if (!data) {
      erros.push({ aba: aba.nome, linha, campo: "data", erro: "data inválida" });
      return;
    }
    const documento = normalizarDocumento(clienteBruto);
    out.push({
      sourceRow: linha,
      clienteRef: documento ?? clienteBruto,
      clienteRefEhDocumento: documento != null,
      data,
      modalidade: enumFechado(coluna(raw, "modalidade"), ["MRR", "TCV"] as const),
      valorMensal: parseMoneyCell(coluna(raw, "valor_mensal", "valormensal", "valor_novo", "valor")),
      valorTotal: parseMoneyCell(coluna(raw, "valor_total", "valortotal")),
      prazoMeses: (() => {
        const v = coluna(raw, "prazo_meses", "prazomeses", "prazo_novo", "prazo");
        return String(v ?? "").trim() === "" ? null : Math.trunc(Number(v)) || null;
      })(),
      obs: texto(coluna(raw, "obs", "observacao")),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Formato largo → MENSAL
// ---------------------------------------------------------------------------

function converterAbasPorMes(abas: Aba[], erros: ErroDeLinha[]): LinhaMensal[] | null {
  const mensais = abas
    .map((a) => ({ aba: a, comp: parseCompetenciaFlex(a.nome) }))
    .filter((x): x is { aba: Aba; comp: Competence } => x.comp != null);
  if (mensais.length === 0) return null;

  const out: LinhaMensal[] = [];
  for (const { aba, comp } of mensais) {
    aba.linhas.forEach((raw, i) => {
      const linha = parseMensalLinha(
        { ...raw, competencia: comp },
        i + 1,
        aba.nome,
        erros
      );
      if (linha) out.push(linha);
    });
  }
  return out;
}

function converterColunasPorMes(aba: Aba, erros: ErroDeLinha[]): LinhaMensal[] | null {
  if (aba.linhas.length === 0) return null;
  const cabecalhos = Object.keys(aba.linhas[0]);
  const colunasDeMes = cabecalhos
    .map((h) => ({ h, comp: parseCompetenciaFlex(h) }))
    .filter((x): x is { h: string; comp: Competence } => x.comp != null);
  if (colunasDeMes.length < 2) return null; // 1 coluna-mês não caracteriza o formato

  const temCliente = cabecalhos.some((h) => {
    const c = chave(h);
    return c === "cliente" || c === "nome" || c === "documento";
  });
  if (!temCliente) return null;

  const out: LinhaMensal[] = [];
  aba.linhas.forEach((raw, i) => {
    const clienteBruto = texto(coluna(raw, "cliente", "documento", "nome"));
    if (!clienteBruto) return;
    const documento = normalizarDocumento(clienteBruto);
    for (const { h, comp } of colunasDeMes) {
      const celula = String(raw[h] ?? "").trim();
      if (!celula) continue;
      const status = parseStatusPagamento(celula);
      if (!status) {
        erros.push({
          aba: aba.nome, linha: i + 1, campo: h,
          erro: `"${celula}" fora do vocabulário de status_pagamento`,
        });
        continue;
      }
      if (status.tipo === "PARCIAL") {
        erros.push({
          aba: aba.nome, linha: i + 1, campo: h,
          erro: "Parcial exige valor_pago — use o formato longo (aba MENSAL) para este mês",
        });
        continue;
      }
      out.push({
        sourceRow: i + 1,
        sourceSheet: aba.nome,
        competencia: comp,
        clienteRef: documento ?? clienteBruto,
        clienteRefEhDocumento: documento != null,
        valorCobrado: null, // vem do termo vigente
        status,
        statusBruto: celula,
        dataPagamento: null,
        valorPago: null,
        estabilidade: null,
        ads: null,
        risco: null,
        upsell: null,
        gestor1DoMes: null,
        obsDoMes: null,
      });
    }
  });
  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Entrada única
// ---------------------------------------------------------------------------

export function parsePlanilhaTotal(buffer: Buffer): PlanilhaTotal {
  const erros: ErroDeLinha[] = [];
  const avisos: string[] = [];
  const abas = lerLivro(buffer);

  const abaClientes = achaAba(abas, ABA_CLIENTES);
  const clientes = abaClientes ? parseClientes(abaClientes, erros) : [];
  if (!abaClientes)
    avisos.push(
      "Sem aba CLIENTES: só clientes que já existem no sistema serão reconhecidos na MENSAL."
    );

  const abaRenov = achaAba(abas, ABA_RENOVACOES);
  const renovacoes = abaRenov ? parseRenovacoes(abaRenov, erros) : [];

  const abaMensal = achaAba(abas, ABA_MENSAL);
  if (abaMensal) {
    const mensal: LinhaMensal[] = [];
    abaMensal.linhas.forEach((raw, i) => {
      const l = parseMensalLinha(raw, i + 1, abaMensal.nome, erros);
      if (l) mensal.push(l);
    });
    return { formato: "longo", clientes, mensal, renovacoes, erros, avisos };
  }

  // Formato largo (a): uma aba por mês.
  const naoCanonicas = abas.filter(
    (a) =>
      a !== abaClientes &&
      a !== abaRenov &&
      chave(a.nome) !== chave("Instruções")
  );
  const porAba = converterAbasPorMes(naoCanonicas, erros);
  if (porAba) {
    avisos.push("Formato largo detectado: uma aba por mês, convertida para o formato mensal.");
    return { formato: "largo-abas", clientes, mensal: porAba, renovacoes, erros, avisos };
  }

  // Formato largo (b): colunas de meses lado a lado.
  for (const aba of naoCanonicas) {
    const porColunas = converterColunasPorMes(aba, erros);
    if (porColunas) {
      avisos.push(
        `Formato largo detectado: colunas de meses na aba "${aba.nome}", convertidas para o formato mensal.`
      );
      return { formato: "largo-colunas", clientes, mensal: porColunas, renovacoes, erros, avisos };
    }
  }

  if (clientes.length === 0)
    erros.push({
      aba: "(livro)", linha: 0, campo: "abas",
      erro: "Nenhuma aba reconhecida — baixe o modelo e preencha CLIENTES e MENSAL.",
    });
  return { formato: "longo", clientes, mensal: [], renovacoes, erros, avisos };
}
