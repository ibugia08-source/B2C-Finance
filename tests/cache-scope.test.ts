import { describe, expect, it } from "vitest";
import { sameCacheScope, scopeFromSession, scopeKeyParts } from "@/lib/cache-scope";
import { METRIC_REGISTRY_VERSION } from "@/lib/metrics/registry";

/**
 * F1.11 — cache com escopo seguro (03 §1.4).
 *
 * A FALHA, em uma frase: numa equipe, Admin e Gestor compartilham o mesmo
 * `ownerId` (o dono do workspace). Com a chave sendo só o ownerId, uma
 * resposta calculada para o Admin podia ser SERVIDA ao Gestor — inclusive
 * com números que o Gestor não pode ver.
 *
 * O teste central é literalmente o que a tarefa pede: "teste provando que
 * cache de Admin não serve Gestor".
 */
const sessao = (uid: string, role: string, own?: string) =>
  ({ uid, role, own, exp: 0 }) as any;

describe("F1.11 — escopo da chave de cache", () => {
  it("cache do Admin NÃO serve o Gestor, mesmo na mesma equipe", () => {
    const admin = scopeFromSession(sessao("u-admin", "ADMIN", "dono-1"));
    const gestor = scopeFromSession(sessao("u-gestor", "GESTOR", "dono-1"));

    // O ponto da falha: o dono é o MESMO.
    expect(admin.ownerId).toBe(gestor.ownerId);
    // E ainda assim as chaves são diferentes.
    expect(sameCacheScope(admin, gestor)).toBe(false);
    expect(scopeKeyParts(admin)).not.toEqual(scopeKeyParts(gestor));
  });

  it("dois usuários com o MESMO papel também não compartilham", () => {
    const a = scopeFromSession(sessao("u-1", "GESTOR", "dono-1"));
    const b = scopeFromSession(sessao("u-2", "GESTOR", "dono-1"));
    expect(sameCacheScope(a, b)).toBe(false);
  });

  it("a mesma sessão compartilha consigo mesma — senão o cache não serviria para nada", () => {
    const a = scopeFromSession(sessao("u-1", "GESTOR", "dono-1"));
    const b = scopeFromSession(sessao("u-1", "GESTOR", "dono-1"));
    expect(sameCacheScope(a, b)).toBe(true);
  });

  it("a troca de papel do MESMO usuário invalida o cache", () => {
    const antes = scopeFromSession(sessao("u-1", "GESTOR", "dono-1"));
    const depois = scopeFromSession(sessao("u-1", "FINANCEIRO", "dono-1"));
    expect(sameCacheScope(antes, depois)).toBe(false);
  });

  it("a versão do dicionário de métricas entra na chave", () => {
    const s = scopeFromSession(sessao("u-1", "ADMIN", "dono-1"));
    expect(s.metricVersion).toBe(METRIC_REGISTRY_VERSION);
    expect(scopeKeyParts(s)).toContain(`m${METRIC_REGISTRY_VERSION}`);
    // Fórmula que muda de versão não pode ser servida do cache antigo: o
    // número estaria certo para a regra ERRADA.
    const outraVersao = { ...s, metricVersion: METRIC_REGISTRY_VERSION + 1 };
    expect(sameCacheScope(s, outraVersao)).toBe(false);
  });

  it("sem sessão, a chave é a do anônimo sem dono — fail-closed", () => {
    const s = scopeFromSession(null);
    expect(s.ownerId).toBeNull();
    expect(scopeKeyParts(s)).toEqual([
      "__no_owner__", "__anon__", "__no_role__", `m${METRIC_REGISTRY_VERSION}`,
    ]);
  });

  it("token antigo sem o claim de equipe cai no próprio uid", () => {
    const s = scopeFromSession(sessao("u-solo", "ADMIN"));
    expect(s.ownerId).toBe("u-solo");
  });
});
