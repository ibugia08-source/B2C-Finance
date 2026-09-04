import * as XLSX from "xlsx";
import { ESTABILIDADE, ADS_STATUS, RISCO } from "@/lib/avaliacao-meta";

/**
 * MODELO DA IMPORTAÇÃO TOTAL (F1.11 v2 · seção IMPORTAÇÃO TOTAL do plano).
 *
 * Três abas: CLIENTES (1 linha por cliente), MENSAL (1 linha por cliente ×
 * mês — é ela que constrói o passado) e RENOVACOES (opcional). O arquivo
 * baixável leva uma quarta aba de instruções com os vocabulários fechados,
 * porque vocabulário aberto vira dado sujo no segundo mês de uso.
 */

export const ABA_CLIENTES = "CLIENTES";
export const ABA_MENSAL = "MENSAL";
export const ABA_RENOVACOES = "RENOVACOES";

export const STATUS_PAGAMENTO = [
  "Pago",
  "Pago com atraso",
  "Pago em MM/AAAA",
  "A vencer",
  "Vencido",
  "Sem cobrança",
  "Removido",
  "Parcial",
] as const;

export const STATUS_ATUAL = ["Ativo", "Pausado", "Churn", "Onboarding"] as const;
export const UPSELL_PLANILHA = ["sim", "não"] as const;

export const COLUNAS_CLIENTES = [
  "nome*", "documento", "agencia", "grupo_economico", "nicho", "cidade", "uf",
  "canal_origem", "sdr_origem", "closer_origem", "data_entrada*", "modalidade*",
  "valor_mensal", "valor_total", "prazo_meses", "dia_vencimento", "servicos",
  "gestor_1", "gestor_2", "status_atual*", "data_churn", "motivo_churn", "obs",
] as const;

export const COLUNAS_MENSAL = [
  "competencia*", "cliente*", "valor_cobrado", "status_pagamento*",
  "data_pagamento", "valor_pago", "estabilidade", "ads", "risco", "upsell",
  "gestor_1_do_mes", "obs_do_mes",
] as const;

export const COLUNAS_RENOVACOES = [
  "cliente*", "data*", "modalidade", "valor_mensal", "valor_total", "prazo_meses", "obs",
] as const;

const EXEMPLO_CLIENTES = [
  "Empresa Alfa", "12.345.678/0001-00", "B2C Gestão", "", "E-commerce", "Salvador", "BA",
  "Indicação", "", "", "15/01/2026", "MRR", "2500,00", "", "", "10",
  "Gestão de tráfego; Social media", "Maria", "", "Ativo", "", "", "",
];

const EXEMPLO_MENSAL = [
  ["2026-01", "12.345.678/0001-00", "2500,00", "Pago", "10/01/2026", "", "Estável", "Ativo", "Baixo", "não", "Maria", ""],
  ["2026-02", "12.345.678/0001-00", "2500,00", "Pago com atraso", "18/02/2026", "", "Observação", "Ativo", "Médio", "não", "Maria", "atrasou 8 dias"],
  ["2026-03", "12.345.678/0001-00", "3000,00", "Pago em 05/2026", "", "", "Estável", "Ativo", "Baixo", "sim", "Maria", "novo valor a partir de março"],
];

const EXEMPLO_RENOVACOES = [
  ["12.345.678/0001-00", "01/03/2026", "MRR", "3000,00", "", "", "reajuste anual"],
];

/** Monta o arquivo-modelo (.xlsx) com as 3 abas + instruções. */
export function montarModeloXlsx(): Buffer {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([[...COLUNAS_CLIENTES], EXEMPLO_CLIENTES]),
    ABA_CLIENTES
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([[...COLUNAS_MENSAL], ...EXEMPLO_MENSAL]),
    ABA_MENSAL
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([[...COLUNAS_RENOVACOES], ...EXEMPLO_RENOVACOES]),
    ABA_RENOVACOES
  );

  const inst: string[][] = [
    ["IMPORTAÇÃO TOTAL — como preencher"],
    [""],
    ["Colunas com * são obrigatórias. Datas em DD/MM/AAAA. Valores em 1.234,56."],
    ["Competência: AAAA-MM (2026-03) ou MM/AAAA (03/2026)."],
    [""],
    ["CLIENTES — 1 linha por cliente. O documento (CNPJ/CPF) é a chave que"],
    ["evita duplicar; sem ele, o casamento é pelo nome exato."],
    ["modalidade: MRR | TCV · status_atual: " + STATUS_ATUAL.join(" | ")],
    [""],
    ["MENSAL — 1 linha por cliente × mês. É esta aba que constrói o passado:"],
    ["cobranças, pagamentos e avaliação de cada competência."],
    ["status_pagamento: " + STATUS_PAGAMENTO.join(" | ")],
    ["  · Pago em MM/AAAA = recebido em outro mês (recuperação). Ex.: Pago em 05/2026"],
    ["  · Parcial exige valor_pago · Sem cobrança = mês sem faturamento (com motivo em obs)"],
    ["estabilidade: " + ESTABILIDADE.join(" | ") + " · ads: " + ADS_STATUS.join(" | ")],
    ["risco: " + RISCO.join(" | ") + " · upsell: sim | não"],
    ["Se valor_cobrado mudar de um mês para outro, o sistema abre um novo"],
    ["termo comercial a partir daquele mês — o histórico de preço fica correto."],
    [""],
    ["RENOVACOES (opcional) — 1 linha por evento de renovação/reajuste."],
    [""],
    ["FORMATO LARGO: também aceitamos uma aba por mês (nome da aba = mês, ex."],
    ["2026-01 ou JAN 2026) com colunas cliente + status_pagamento; ou uma aba"],
    ["única com coluna cliente e uma coluna por mês, onde a célula é o status."],
    ["Nesses formatos o valor cobrado vem do termo vigente do cliente."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inst), "Instruções");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
