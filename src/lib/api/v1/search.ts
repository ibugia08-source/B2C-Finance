import { prisma } from "@/lib/prisma";
import { getStatusesAtDate } from "@/lib/clients/status-history";
import { todayKey } from "@/lib/competence";
import { mascararDocumento, statusDoCliente } from "./common";

/**
 * BUSCA PARA O AGENTE (/api/v1/search) — desambiguar "face love" em
 * "Face Love Estética (Face Love Clínica Ltda)" sem trazer dados demais.
 *
 * Casamento feito em memória sobre id/nome/razão social/documento do dono
 * (uma consulta leve): assim a busca ignora acento, caixa e espaço
 * ("facelove" acha "Face Love"), coisa que o `contains` do banco não faz sem
 * extensão. A carteira de uma agência cabe folgada nesse modelo; se crescer
 * para dezenas de milhares, troca-se por índice trigram sem mudar o contrato.
 */

export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Candidato = { id: string; name: string; legalName: string | null; document: string | null; modality: string | null };

/** Pontuação 0 (não casa) a 100 (nome idêntico). Exportada para teste. */
export function pontuar(c: Candidato, termo: string): number {
  const q = normalizar(termo);
  if (!q) return 0;
  const qCompacto = q.replace(/ /g, "");
  const tokens = q.split(" ");
  const digitos = termo.replace(/\D/g, "");
  let melhor = 0;
  for (const [campo, peso] of [[c.name, 1], [c.legalName, 0.9]] as const) {
    if (!campo) continue;
    const v = normalizar(campo);
    const vCompacto = v.replace(/ /g, "");
    let p = 0;
    if (v === q) p = 100;
    else if (v.startsWith(q)) p = 90;
    else if (v.split(" ").some((w) => w.startsWith(q)) || v.includes(q)) p = 75;
    else if (qCompacto.length >= 3 && vCompacto.includes(qCompacto)) p = 70;
    else if (tokens.every((t) => v.includes(t))) p = 60;
    melhor = Math.max(melhor, p * peso);
  }
  if (digitos.length >= 4 && c.document?.replace(/\D/g, "").includes(digitos)) melhor = Math.max(melhor, 80);
  return Math.round(melhor);
}

export async function buscarClientesApi(q: string, limit: number) {
  const todos = await prisma.client.findMany({
    select: { id: true, name: true, legalName: true, document: true, modality: true },
  });
  const achados = todos
    .map((c) => ({ c, score: pontuar(c, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name, "pt-BR"));
  const topo = achados.slice(0, limit);
  const status = await getStatusesAtDate(todayKey(), topo.map((x) => x.c.id));
  return {
    total: achados.length,
    results: topo.map(({ c, score }) => ({
      type: "client" as const,
      id: c.id,
      name: c.name,
      legalName: c.legalName,
      document: mascararDocumento(c.document),
      status: statusDoCliente(status.get(c.id)),
      modality: c.modality,
      score,
    })),
  };
}
