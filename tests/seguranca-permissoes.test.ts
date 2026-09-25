import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, asOwner, defaultAgency, type TestOwner,
} from "./support/db";

/**
 * Correções de segurança de 25/09/2026:
 *  A3 — permissão por relatório (tela, PDF, exportação);
 *  M1 — categorias (globais) exigem configuracoes.editar;
 *  M2 — escalada de privilégio e tomada de conta em usuários;
 *  B2 — update/delete por id sem escopo de dono (contas, regras).
 */

const estado = vi.hoisted(() => ({ viewer: null as any }));

vi.mock("@/lib/auth/viewer", async () => {
  const { hasPermission } = await import("@/lib/permissions");
  const guard = async (p: string) => {
    if (!hasPermission(estado.viewer, p)) throw new Error("NEXT_REDIRECT /acesso-restrito");
    return estado.viewer;
  };
  return {
    getViewer: async () => estado.viewer,
    requirePermission: guard,
    requirePagePermission: guard,
    tryPermission: async (p: string) => (hasPermission(estado.viewer, p) ? estado.viewer : null),
    requireAdmin: async () => estado.viewer,
    NO_PERMISSION: { ok: false, error: "Sem permissão." },
    can: (v: any, p: string) => hasPermission(v, p),
  };
});
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => estado.viewer }));
vi.mock("@/lib/revalidate", () => ({
  revalidateAssistant: () => {}, revalidateFinance: () => {}, revalidateAdmin: () => {},
}));
vi.mock("next/cache", async (orig) => ({
  ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {},
}));

let owner: TestOwner;
let outro: TestOwner;
const criados: string[] = [];

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const v = (id: string, role: string, extra: string[] = [], workspaceOwnerId: string | null = null) => ({
  id, name: role, email: `${id}@b2c.local`, role, personId: null, workspaceOwnerId,
  permissions: extra.map((permission) => ({ permission, enabled: true })),
});

async function novoUsuario(role: string, workspaceOwnerId: string | null) {
  const u = await runWithoutScope(async () =>
    prisma.user.create({
      data: {
        name: role, email: `u-${randomUUID()}@b2c.local`, passwordHash: "hash-original",
        role, workspaceOwnerId,
      },
    })
  );
  criados.push(u.id);
  return u;
}

beforeAll(async () => {
  owner = await createOwner();
  outro = await createOwner();
});

afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.userPermission.deleteMany({ where: { userId: { in: criados } } });
    await prisma.user.deleteMany({ where: { id: { in: criados } } });
    await prisma.account.deleteMany({ where: { ownerId: { in: [owner.id, outro.id] } } });
    await prisma.categorizationRule.deleteMany({ where: { ownerId: { in: [owner.id, outro.id] } } });
  });
  await destroyOwner(owner);
  await destroyOwner(outro);
});

// ---------------------------------------------------------------------------
describe("A3 — permissão por relatório", () => {
  it("todo relatório tem permissão mapeada", async () => {
    const { REPORTS, REPORT_PERMISSIONS } = await import("@/lib/reports/registry");
    for (const r of REPORTS) expect(REPORT_PERMISSIONS[r.key], r.key).toBeDefined();
  });

  it("folha exige folha.visualizar; ADMIN vê tudo", async () => {
    const { getReport, canViewReport, REPORTS } = await import("@/lib/reports/registry");
    const folha = getReport("folha")!;
    expect(canViewReport(v("x", "GESTOR"), folha)).toBe(false);
    expect(canViewReport(v("x", "FINANCEIRO"), folha)).toBe(false);
    expect(canViewReport(v("x", "GESTOR", ["folha.visualizar"]), folha)).toBe(true);
    expect(canViewReport(v("x", "GESTOR"), getReport("despesas")!)).toBe(true);
    expect(canViewReport(v("x", "COBRANCA"), getReport("caixa")!)).toBe(false);
    // Financeiro mensal tem a coluna Folha: exige as duas permissões.
    expect(canViewReport(v("x", "GESTOR"), getReport("financeiro-mensal")!)).toBe(false);
    for (const r of REPORTS) expect(canViewReport(v("x", "ADMIN"), r)).toBe(true);
    // Contador: todos os relatórios da agência, menos a folha nominal.
    expect(canViewReport(v("x", "CONTADOR"), getReport("executivo")!)).toBe(true);
    expect(canViewReport(v("x", "CONTADOR"), getReport("financeiro-mensal")!)).toBe(true);
    expect(canViewReport(v("x", "CONTADOR"), getReport("caixa")!)).toBe(true);
    expect(canViewReport(v("x", "CONTADOR"), folha)).toBe(false);
    // Sem relatorios.visualizar, nada.
    expect(canViewReport(v("x", "LEITURA"), getReport("clientes")!)).toBe(false);
  });

  it("exportação da folha devolve 403 sem folha.visualizar", async () => {
    const { GET } = await import("@/app/relatorios/[tipo]/export/route");
    estado.viewer = v("x", "GESTOR", ["relatorios.exportar"]);
    const req: any = { nextUrl: new URL("http://localhost/relatorios/folha/export?formato=csv") };
    const res = await GET(req, { params: { tipo: "folha" } });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("M1 — categorias exigem configuracoes.editar", () => {
  it("GESTOR não cria nem exclui; ADMIN cria", async () => {
    const { saveCategory, deleteCategory } = await import("@/lib/actions/categories");
    const nome = `Cat-${randomUUID()}`;
    estado.viewer = v(owner.id, "GESTOR");
    await expect(saveCategory(form({ name: nome }))).rejects.toThrow(/acesso-restrito/);
    expect(await prisma.category.count({ where: { name: nome } })).toBe(0);

    estado.viewer = v(owner.id, "ADMIN");
    await saveCategory(form({ name: nome }));
    const cat = await prisma.category.findUniqueOrThrow({ where: { name: nome } });

    estado.viewer = v(owner.id, "GESTOR");
    await expect(deleteCategory(cat.id)).rejects.toThrow(/acesso-restrito/);
    expect(await prisma.category.count({ where: { id: cat.id } })).toBe(1);

    estado.viewer = v(owner.id, "ADMIN");
    await deleteCategory(cat.id);
    expect(await prisma.category.count({ where: { id: cat.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("M2 — usuários", () => {
  const SO_CRIAR = ["usuarios.criar", "usuarios.editar", "usuarios.excluir"];

  it("sem alterar_permissoes não escolhe papel além do mais restrito", async () => {
    const { createUser } = await import("@/lib/actions/users");
    const criador = await novoUsuario("GESTOR", owner.id);
    estado.viewer = v(criador.id, "GESTOR", SO_CRIAR, owner.id);

    const negado = await createUser(
      form({ name: "X", email: `x-${randomUUID()}@b2c.local`, password: "123456", role: "FINANCEIRO" })
    );
    expect(negado.ok).toBe(false);

    // Select desabilitado na tela: sem papel no form → nasce LEITURA.
    const email = `y-${randomUUID()}@b2c.local`;
    const ok = await createUser(form({ name: "Y", email, password: "123456" }));
    expect(ok.ok).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    criados.push(u.id);
    expect(u.role).toBe("LEITURA");
    expect(u.workspaceOwnerId).toBe(owner.id);
  });

  it("criador de uma agência não cria usuário com visão do workspace inteiro", async () => {
    const { createUser } = await import("@/lib/actions/users");
    const agencia = await defaultAgency();
    const criador = await novoUsuario("GESTOR", owner.id);
    await runWithoutScope(async () =>
      prisma.user.update({
        where: { id: criador.id },
        data: { dataScope: "AGENCY", scopeAgencyId: agencia.id },
      })
    );
    estado.viewer = v(criador.id, "GESTOR", SO_CRIAR, owner.id);
    const email = `z-${randomUUID()}@b2c.local`;
    const r = await createUser(form({ name: "Z", email, password: "123456", dataScope: "WORKSPACE" }));
    expect(r.ok).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    criados.push(u.id);
    expect(u.dataScope).toBe("AGENCY");
    expect(u.scopeAgencyId).toBe(agencia.id);
  });

  it("usuarios.editar não troca senha nem e-mail de outra pessoa", async () => {
    const { updateUser } = await import("@/lib/actions/users");
    const editor = await novoUsuario("GESTOR", owner.id);
    const alvo = await novoUsuario("LEITURA", owner.id);
    estado.viewer = v(editor.id, "GESTOR", SO_CRIAR, owner.id);

    const base = { id: alvo.id, name: "Novo nome", email: alvo.email };
    const senha = await updateUser(form({ ...base, password: "tomada123" }));
    expect(senha.ok).toBe(false);
    const email = await updateUser(form({ ...base, email: `atacante-${randomUUID()}@b2c.local` }));
    expect(email.ok).toBe(false);
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: alvo.id } });
    expect(depois.passwordHash).toBe("hash-original");
    expect(depois.email).toBe(alvo.email);

    // Nome sim (papel não enviado = mantém LEITURA, não vira troca de papel).
    const nome = await updateUser(form(base));
    expect(nome).toEqual({ ok: true });

    // Com alterar_permissoes, pode.
    estado.viewer = v(editor.id, "GESTOR", [...SO_CRIAR, "usuarios.alterar_permissoes"], owner.id);
    const r = await updateUser(form({ ...base, role: "LEITURA", password: "nova1234" }));
    expect(r).toEqual({ ok: true });
  });

  it("não edita nem exclui usuário de outro workspace", async () => {
    const { updateUser, deleteUser } = await import("@/lib/actions/users");
    const estranho = await novoUsuario("LEITURA", outro.id);
    estado.viewer = v(owner.id, "ADMIN");
    const up = await updateUser(
      form({ id: estranho.id, name: "Hackeado", email: estranho.email, role: "LEITURA" })
    );
    expect(up.ok).toBe(false);
    const del = await deleteUser(estranho.id);
    expect(del.ok).toBe(false);
    const ainda = await prisma.user.findUniqueOrThrow({ where: { id: estranho.id } });
    expect(ainda.name).toBe("LEITURA");
  });
});

// ---------------------------------------------------------------------------
describe("B2 — update/delete por id respeitam o dono", () => {
  it("salvarConta não altera conta de outro workspace", async () => {
    const { salvarConta } = await import("@/lib/actions/contas");
    const conta = await asOwner(outro, async () =>
      prisma.account.create({ data: { name: "Conta alheia", balance: 10 } })
    );
    estado.viewer = v(owner.id, "ADMIN");
    const r = await asOwner(owner, async () =>
      salvarConta(form({ id: conta.id, name: "Invadida", type: "corrente", balance: "999" }))
    );
    expect(r.ok).toBe(false);
    const depois = await runWithoutScope(async () =>
      prisma.account.findUniqueOrThrow({ where: { id: conta.id } })
    );
    expect(depois.name).toBe("Conta alheia");

    // A própria conta continua editável.
    const minha = await asOwner(owner, async () =>
      prisma.account.create({ data: { name: "Minha", balance: 1 } })
    );
    const ok = await asOwner(owner, async () =>
      salvarConta(form({ id: minha.id, name: "Minha 2", type: "corrente", balance: "5" }))
    );
    expect(ok).toEqual({ ok: true, id: minha.id });
  });

  it("saveRule/deleteRule não tocam regra de outro workspace", async () => {
    const { saveRule, deleteRule } = await import("@/lib/actions/rules");
    const regra = await asOwner(outro, async () =>
      prisma.categorizationRule.create({ data: { name: "Regra alheia" } })
    );
    estado.viewer = v(owner.id, "ADMIN");
    await expect(
      asOwner(owner, async () => saveRule(form({ id: regra.id, name: "Invadida" })))
    ).rejects.toThrow(/não encontrada/);
    await expect(asOwner(owner, async () => deleteRule(regra.id))).rejects.toThrow(/não encontrada/);
    const depois = await runWithoutScope(async () =>
      prisma.categorizationRule.findUnique({ where: { id: regra.id } })
    );
    expect(depois?.name).toBe("Regra alheia");
  });
});
