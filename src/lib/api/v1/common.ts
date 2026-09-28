import { z } from "zod";
import { CLIENT_STATUS_LABEL } from "@/lib/status-meta";
import { civilDateKeyOf, todayKey, type Competence } from "@/lib/competence";
import { ApiError } from "../auth";

/** Status de cliente aceitos nos filtros (ClientStatus do banco). */
export const CLIENT_STATUSES = [
  "LEAD", "PROSPECT", "ACTIVE", "INACTIVE", "PAUSED", "RENEWAL", "DELINQUENT", "CHURNED",
] as const;

export const statusDoCliente = (s: string | null | undefined) =>
  s ? { code: s, label: CLIENT_STATUS_LABEL[s] ?? s } : null;

/** Dia civil ("AAAA-MM-DD") de uma data gravada como data civil. */
export const dia = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  // Texto vindo de cache (ownerCached serializa Date) — ver `instante`.
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : civilDateKeyOf(x);
};

export const competenciaAtual = (): Competence => todayKey().slice(0, 7);

/** Limites UTC [início, fim) de um intervalo de dias civis inclusivo. */
export function intervaloDeDias(de: string, ate: string, maxDias = 400): { gte: Date; lt: Date } {
  const gte = new Date(`${de}T00:00:00.000Z`);
  const lt = new Date(`${ate}T00:00:00.000Z`);
  lt.setUTCDate(lt.getUTCDate() + 1);
  if (lt <= gte) throw new ApiError(400, "validation_error", "dateTo não pode ser anterior a dateFrom.");
  if ((lt.getTime() - gte.getTime()) / 86_400_000 > maxDias) {
    throw new ApiError(400, "validation_error", `O intervalo máximo é de ${maxDias} dias.`);
  }
  return { gte, lt };
}

/** Intervalo de uma competência (primeiro dia até o último, inclusivo). */
export function intervaloDaCompetencia(c: Competence): { gte: Date; lt: Date } {
  const [y, m] = c.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

/**
 * Documento com máscara para listas e busca: basta para desambiguar
 * ("…/0001-90"), não para identificar a pessoa. CPF mostra só os dígitos
 * verificadores; o detalhe do cliente (`GET /clients/:id`) traz o completo.
 */
export function mascararDocumento(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const d = doc.replace(/\D/g, "");
  if (d.length === 14) return `**.***.***/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `***.***.***-${d.slice(9)}`;
  return d.length > 4 ? `${"*".repeat(d.length - 2)}${d.slice(-2)}` : "****";
}

/** Booleano de query string ("true"/"false"). */
export const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");
