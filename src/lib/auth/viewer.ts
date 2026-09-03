import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { hasPermission } from "@/lib/permissions";

export type Viewer = CurrentUser & { personId: string | null };

/** Person vinculada memoizada por request (1 consulta por render). */
const getPersonIdForUser = cache(async (userId: string): Promise<string | null> => {
  const person = await prisma.person.findFirst({
    where: { userId },
    select: { id: true },
  });
  return person?.id ?? null;
});

/**
 * Retorna o usuário logado + Person vinculada (quando houver).
 * Não autenticado → redirect /login (com `from`, se fornecido).
 */
export async function getViewer(from?: string): Promise<Viewer> {
  const user = await getCurrentUser();
  // Sem usuário aqui significa que o cookie PASSOU pelo middleware (a
  // assinatura confere) mas não há ninguém no banco por trás dele — conta
  // apagada ou desativada. Mandar direto para /login criaria um laço
  // infinito: o middleware veria a sessão como válida e devolveria para o
  // painel. A rota abaixo APAGA o cookie antes de voltar para o login.
  if (!user) redirect(`/api/auth/encerrar${from ? `?from=${encodeURIComponent(from)}` : ""}`);

  const personId = await getPersonIdForUser(user.id);
  return { ...user, personId };
}

/**
 * Restrição admin-only para páginas de servidor.
 * Não-admin é redirecionado para /dashboard com flag de denied.
 */
export async function requireAdmin(): Promise<Viewer> {
  const v = await getViewer();
  if (v.role !== "ADMIN") redirect("/dashboard?denied=admin");
  return v;
}

/** Checagem síncrona de permissão sobre um viewer já carregado. */
export function can(v: Viewer | CurrentUser | null, permission: string): boolean {
  return hasPermission(v, permission);
}

/**
 * Guarda de SERVER ACTION: sessão obrigatória + permissão obrigatória.
 * Sem permissão → redireciona para a tela de acesso restrito (mesmo padrão do
 * requireAdmin, que redirecionava; um Error lançado aqui seria mascarado pelo
 * Next em produção, pois o guard fica FORA do try/catch das actions — de
 * propósito, para o redirect de sessão expirada não ser engolido).
 */
export async function requirePermission(permission: string): Promise<Viewer> {
  const v = await getViewer();
  if (!hasPermission(v, permission)) redirect("/acesso-restrito");
  return v;
}

/**
 * Guarda de AÇÃO INLINE (selects/botões dentro de tabelas): sessão obrigatória
 * (sem sessão → /login, como sempre); sem a permissão retorna null para a
 * action responder `{ ok:false, error }` NO LUGAR — o redirect para
 * /acesso-restrito no meio de um gesto jogava o usuário para fora da tela,
 * perdendo mês, filtros e seleção (auditoria 2026-08-13). Páginas e dialogs
 * de navegação continuam com requirePermission/requirePagePermission.
 */
export async function tryPermission(permission: string): Promise<Viewer | null> {
  const v = await getViewer();
  return hasPermission(v, permission) ? v : null;
}

/** Resposta padrão de action para gesto sem permissão. */
export const NO_PERMISSION = {
  ok: false as const,
  error: "Você não tem permissão para esta ação — fale com o administrador.",
};

/**
 * Guarda de PÁGINA: sessão obrigatória + permissão de visualização.
 * Sem permissão → redireciona para a tela de acesso restrito (sem loop:
 * /acesso-restrito não exige permissão nenhuma, só sessão).
 */
export async function requirePagePermission(permission: string, from?: string): Promise<Viewer> {
  const v = await getViewer(from);
  if (!hasPermission(v, permission)) redirect("/acesso-restrito");
  return v;
}
