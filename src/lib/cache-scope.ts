import { METRIC_REGISTRY_VERSION } from "@/lib/metrics/registry";
import type { SessionPayload } from "@/lib/auth/session";

/**
 * ESCOPO DA CHAVE DE CACHE (F1.11 · ref. 03 §1.4).
 *
 * A FALHA QUE ISTO FECHA, em uma frase: numa equipe, Admin e Gestor
 * compartilham o mesmo `ownerId` (o dono do workspace). Como a chave de
 * cache era só o ownerId, uma resposta calculada para o Admin podia ser
 * servida ao Gestor — inclusive com números que o Gestor não tem
 * permissão de ver. Cache não é lugar de descobrir isso em produção.
 *
 * A chave passa a incluir o USUÁRIO e o PAPEL. Sim, o cache fica por
 * pessoa em vez de por equipe, e a taxa de acerto cai — mas a equipe tem
 * poucos usuários e servir dado errado é um preço que não se paga por
 * desempenho.
 *
 * A versão do dicionário de métricas também entra: quando uma fórmula
 * muda de versão, o valor antigo em cache passaria a mentir sobre qual
 * regra o produziu.
 *
 * Derivação PURA e a partir do TOKEN, sem tocar o banco: a extensão do
 * Prisma chama isto a cada query, e uma consulta por chamada seria pior
 * que o problema original.
 */
export type CacheScope = {
  ownerId: string | null;
  userId: string | null;
  role: string | null;
  metricVersion: number;
};

export function scopeFromSession(payload: SessionPayload | null): CacheScope {
  return {
    ownerId: payload ? (payload.own ?? payload.uid) : null,
    userId: payload?.uid ?? null,
    role: payload?.role ?? null,
    metricVersion: METRIC_REGISTRY_VERSION,
  };
}

/**
 * Partes que compõem a chave, em ordem estável. Duas sessões diferentes
 * SÓ podem compartilhar cache se todas as partes forem iguais.
 */
export function scopeKeyParts(scope: CacheScope): string[] {
  return [
    scope.ownerId ?? "__no_owner__",
    scope.userId ?? "__anon__",
    scope.role ?? "__no_role__",
    `m${scope.metricVersion}`,
  ];
}

/** Duas sessões podem compartilhar a mesma entrada de cache? */
export function sameCacheScope(a: CacheScope, b: CacheScope): boolean {
  const pa = scopeKeyParts(a);
  const pb = scopeKeyParts(b);
  return pa.length === pb.length && pa.every((v, i) => v === pb[i]);
}
