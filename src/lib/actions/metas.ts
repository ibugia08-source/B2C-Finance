"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  apagarMeta, definirMeta, type EscopoDaMeta, type MetricaDeMeta,
} from "@/lib/services/commercial-goals";

export async function definirMetaAction(input: {
  competence: string;
  scopeType: EscopoDaMeta;
  scopeId: string;
  metric: MetricaDeMeta;
  target: number;
}) {
  await requirePermission("comercial.metas");
  const r = await definirMeta(input);
  revalidar();
  return r;
}

export async function apagarMetaAction(id: string) {
  await requirePermission("comercial.metas");
  const r = await apagarMeta(id);
  revalidar();
  return r;
}

function revalidar() {
  revalidatePath("/configuracoes/metas");
  revalidatePath("/atividade");
  revalidatePath("/funil/closer");
}
