"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { domainContextFor } from "@/lib/auth/domain-session";
import {
  criarIntegracao,
  revogarIntegracao,
  rotacionarIntegracao,
} from "@/lib/services/service-accounts";

/**
 * INTEGRAÇÕES (Configurações → Integrações → API). A regra — permissão
 * `integracoes.gerenciar`, validação de scopes, hash, auditoria — mora em
 * lib/services/service-accounts; aqui só sessão, formulário e cache.
 *
 * O token volta na resposta UMA vez e o cliente o mostra no diálogo; a
 * página não o recebe de novo em render nenhum.
 */

const PAGINA = "/configuracoes/integracoes";

export async function criarIntegracaoAction(formData: FormData) {
  const viewer = await getViewer();
  const ctx = await domainContextFor(viewer);
  const validade = String(formData.get("expiresInDays") ?? "");
  const res = await criarIntegracao(ctx, {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    scopes: formData.getAll("scopes").map(String),
    expiresInDays: validade === "" || validade === "never" ? null : Number(validade),
  });
  if (res.ok) revalidatePath(PAGINA);
  return res;
}

export async function revogarIntegracaoAction(id: string) {
  const viewer = await getViewer();
  const res = await revogarIntegracao(await domainContextFor(viewer), id);
  if (res.ok) revalidatePath(PAGINA);
  return res;
}

export async function rotacionarIntegracaoAction(id: string) {
  const viewer = await getViewer();
  const res = await rotacionarIntegracao(await domainContextFor(viewer), id);
  if (res.ok) revalidatePath(PAGINA);
  return res;
}
