import { BILLING_OPEN_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { ADS_STATUS, ESTABILIDADE, RISCO } from "@/lib/avaliacao-meta";

/**
 * PREVISÃO DE CHURN POR SINAIS (F5.4 · ref. 03 roadmap Fase 5).
 *
 * "Previsão" aqui é RÉGUA DECLARADA, não modelo estatístico — os pesos são
 * números redondos decididos como produto, escritos abaixo, e a tela mostra
 * SEMPRE os sinais que compõem a nota. Fingir precisão com um modelo treinado
 * em meia dúzia de churns seria pior que assumir a régua simples (a mesma
 * decisão do pipeline coverage na F4.6). O gestor não precisa de uma
 * probabilidade — precisa de "quais clientes olhar HOJE e por quê".
 *
 * Os quatro sinais são os que o plano nomeia: estabilidade, atraso, ads
 * pausado, tenure — mais o risco DECLARADO pelo gestor na avaliação mensal,
 * que é leitura humana e vale mais que qualquer heurística.
 *
 * NULO HONESTO: cliente sem avaliação recente não ganha ponto pelos sinais
 * que ninguém leu — ganha a marca "sem leitura", que é um problema de
 * PROCESSO e aparece como tal.
 */

export const PESO_DO_SINAL = {
  ATRASO: 15,
  ATRASO_GRAVE: 30, // 30+ dias — substitui o leve, não soma
  ESTABILIDADE_OSCILANDO: 10,
  ESTABILIDADE_CAINDO: 25,
  ADS_PAUSADO: 20,
  ADS_SEM_VERBA: 25,
  RISCO_DECLARADO_MEDIO: 10,
  RISCO_DECLARADO_ALTO: 30,
  // A faixa de 2 a 6 meses de vida concentrou 84% das perdas históricas
  // (auditoria de 2026 — ver retention-metrics).
  TENURE_ZONA_DE_RISCO: 15,
} as const;

export const NIVEL_ALTO = 50;
export const NIVEL_ATENCAO = 25;

export type SinalDeChurn = { sinal: string; detalhe: string; pontos: number };

export type PrevisaoDeChurn = {
  relationshipId: string;
  clientId: string;
  cliente: string;
  gestores: string[];
  valorMensal: number;
  pontos: number;
  nivel: "ALTO" | "ATENCAO" | "BAIXO";
  sinais: SinalDeChurn[];
  /** Sem avaliação nas 2 últimas competências: problema de processo, à vista. */
  semLeitura: boolean;
};

// ===================================================================
// Vocabulário da avaliação mensal — leitura tolerante.
// A grade e a importação gravam o vocabulário OFICIAL de avaliacao-meta
// ("Baixo" | "Médio" | "Alto", "Estável" | "Observação" | "Crítico",
// "Ativo" | "Pausado" | "Sem campanha"). Antes os leitores comparavam com
// "alto"/"caindo"/"sem verba" (vocabulário antigo do schema) e NUNCA
// casavam. A leitura agora aceita os dois, sem acento e sem caixa.
// ===================================================================

const normaliza = (v: string | null | undefined) =>
  (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

const [, RISCO_MEDIO, RISCO_ALTO] = RISCO;
const [, ESTAB_OBSERVACAO, ESTAB_CRITICO] = ESTABILIDADE;
const [, ADS_PAUSADO, ADS_SEM_CAMPANHA] = ADS_STATUS;

/** Risco declarado: "alto" | "medio" | null (baixo ou sem leitura). */
export function nivelDeRiscoDeclarado(v: string | null | undefined): "alto" | "medio" | null {
  const x = normaliza(v);
  if (x === normaliza(RISCO_ALTO)) return "alto";
  if (x === normaliza(RISCO_MEDIO)) return "medio";
  return null;
}

/** Estabilidade ruim: "critico" (Crítico / legado caindo) | "observacao" (Observação / legado oscilando). */
export function estabilidadeRuim(v: string | null | undefined): "critico" | "observacao" | null {
  const x = normaliza(v);
  if (x === normaliza(ESTAB_CRITICO) || x === "caindo") return "critico";
  if (x === normaliza(ESTAB_OBSERVACAO) || x === "oscilando") return "observacao";
  return null;
}

/** Ads parado: "sem_campanha" (Sem campanha / legado sem verba) | "pausado". */
export function adsParado(v: string | null | undefined): "sem_campanha" | "pausado" | null {
  const x = normaliza(v);
  if (x === normaliza(ADS_SEM_CAMPANHA) || x === "sem verba") return "sem_campanha";
  if (x === normaliza(ADS_PAUSADO)) return "pausado";
  return null;
}

/**
 * Valores GRAVADOS que o filtro no banco precisa casar (a consulta não
 * normaliza): o oficial e o legado.
 */
export const RISCO_EM_ALERTA_DB = [RISCO_ALTO, RISCO_MEDIO, "alto", "medio", "médio"];
export const ESTABILIDADE_EM_ALERTA_DB = [ESTAB_CRITICO, ESTAB_OBSERVACAO, "caindo", "oscilando"];

function competenciaDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function previsaoDeChurn(hoje: Date = new Date()): Promise<PrevisaoDeChurn[]> {
  const relacoes = await prisma.clientAgencyRelationship.findMany({
    where: { lifecycleStatus: { in: ["ACTIVE", "ONBOARDING"] } },
    select: {
      id: true,
      clientId: true,
      startedAt: true,
      client: { select: { name: true } },
      currentCommercialTerm: { select: { monthlyValue: true } },
      avaliacoes: {
        orderBy: { competence: "desc" },
        take: 1,
        select: { competence: true, estabilidade: true, ads: true, risco: true, gestores: true },
      },
    },
  });
  if (relacoes.length === 0) return [];

  // Atraso por CLIENTE: dias do vencido mais antigo em aberto.
  const vencidas = await prisma.billing.findMany({
    where: {
      clientId: { in: relacoes.map((r) => r.clientId) },
      status: { in: [...BILLING_OPEN_STATUSES] },
      dueDate: { lt: hoje },
      canceledAt: null,
    },
    select: { clientId: true, dueDate: true, amount: true, paidTotal: true },
  });
  const atrasoPorCliente = new Map<string, number>();
  for (const b of vencidas) {
    const aberto = n(b.amount) - n(b.paidTotal);
    if (aberto <= 0.005) continue;
    const dias = Math.floor((hoje.getTime() - b.dueDate.getTime()) / 86_400_000);
    atrasoPorCliente.set(b.clientId, Math.max(atrasoPorCliente.get(b.clientId) ?? 0, dias));
  }

  // "Recente" = a competência atual ou a anterior.
  const anterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const recentes = new Set([competenciaDe(hoje), competenciaDe(anterior)]);

  const out: PrevisaoDeChurn[] = [];
  for (const r of relacoes) {
    const sinais: SinalDeChurn[] = [];
    const a = r.avaliacoes[0] ?? null;
    const leituraRecente = a != null && recentes.has(a.competence);

    const atraso = atrasoPorCliente.get(r.clientId) ?? 0;
    if (atraso >= 30)
      sinais.push({ sinal: "Atraso grave", detalhe: `Vencido há ${atraso} dias.`, pontos: PESO_DO_SINAL.ATRASO_GRAVE });
    else if (atraso > 0)
      sinais.push({ sinal: "Atraso", detalhe: `Vencido há ${atraso} ${atraso === 1 ? "dia" : "dias"}.`, pontos: PESO_DO_SINAL.ATRASO });

    if (leituraRecente && a) {
      const estab = estabilidadeRuim(a.estabilidade);
      if (estab === "critico")
        sinais.push({ sinal: "Resultados caindo", detalhe: `Avaliação do gestor: ${a.estabilidade}.`, pontos: PESO_DO_SINAL.ESTABILIDADE_CAINDO });
      else if (estab === "observacao")
        sinais.push({ sinal: "Resultados oscilando", detalhe: `Avaliação do gestor: ${a.estabilidade}.`, pontos: PESO_DO_SINAL.ESTABILIDADE_OSCILANDO });

      const ads = adsParado(a.ads);
      if (ads === "sem_campanha")
        sinais.push({ sinal: "Sem campanha de anúncios", detalhe: "Cliente sem campanha no ar.", pontos: PESO_DO_SINAL.ADS_SEM_VERBA });
      else if (ads === "pausado")
        sinais.push({ sinal: "Anúncios pausados", detalhe: "Campanhas pausadas.", pontos: PESO_DO_SINAL.ADS_PAUSADO });

      const risco = nivelDeRiscoDeclarado(a.risco);
      if (risco === "alto")
        sinais.push({ sinal: "Risco declarado alto", detalhe: "O gestor marcou risco alto na avaliação.", pontos: PESO_DO_SINAL.RISCO_DECLARADO_ALTO });
      else if (risco === "medio")
        sinais.push({ sinal: "Risco declarado médio", detalhe: "O gestor marcou risco médio na avaliação.", pontos: PESO_DO_SINAL.RISCO_DECLARADO_MEDIO });
    }

    if (r.startedAt) {
      const meses = Math.floor((hoje.getTime() - r.startedAt.getTime()) / (30.44 * 86_400_000));
      if (meses >= 2 && meses <= 6)
        sinais.push({
          sinal: "Zona de risco de vida",
          detalhe: `${meses} meses de casa — a faixa onde as perdas se concentram.`,
          pontos: PESO_DO_SINAL.TENURE_ZONA_DE_RISCO,
        });
    }

    const pontos = sinais.reduce((s, x) => s + x.pontos, 0);
    out.push({
      relationshipId: r.id,
      clientId: r.clientId,
      cliente: r.client.name,
      gestores: a?.gestores ?? [],
      valorMensal: n(r.currentCommercialTerm?.monthlyValue),
      pontos,
      nivel: pontos >= NIVEL_ALTO ? "ALTO" : pontos >= NIVEL_ATENCAO ? "ATENCAO" : "BAIXO",
      sinais,
      semLeitura: !leituraRecente,
    });
  }

  // Quem mais precisa de olhar, primeiro; empate decide pelo valor em jogo.
  return out.sort((a, b) => b.pontos - a.pontos || b.valorMensal - a.valorMensal);
}
