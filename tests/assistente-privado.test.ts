import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { prisma, runWithoutScope, createOwner, destroyOwner, asOwner, type TestOwner } from "./support/db";

/**
 * ASSISTENTE PRIVADO POR USUÁRIO (25/09/2026).
 *
 * A1 — conversas e memórias eram escopadas só pelo dono do WORKSPACE: a equipe
 * inteira via, continuava, fixava e apagava o que era de um colega.
 * A2 — o retrato enviado à IA ignorava as permissões de quem pergunta.
 */

const estado = vi.hoisted(() => ({
  viewer: null as any,
  prompts: [] as string[],
}));

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
    requireAdmin: async () => {
      if (estado.viewer.role !== "ADMIN") throw new Error("NEXT_REDIRECT /dashboard");
      return estado.viewer;
    },
    NO_PERMISSION: { ok: false, error: "Sem permissão." },
    can: (v: any, p: string) => hasPermission(v, p),
  };
});
vi.mock("@/lib/revalidate", () => ({
  revalidateAssistant: () => {}, revalidateFinance: () => {}, revalidateAdmin: () => {},
}));
vi.mock("next/cache", async (orig) => ({
  ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {},
}));
vi.mock("@/lib/ai/provider", () => ({
  getAISettings: async () => ({
    provider: "openai", baseUrl: null, model: "m", temperature: 0, enabled: true, apiKey: "k",
  }),
  isConfigured: () => true,
  testConnection: async () => ({ ok: true, message: "" }),
  chatComplete: async (opts: { system: string }) => {
    estado.prompts.push(opts.system);
    return { text: "resposta", usage: { promptTokens: 1, completionTokens: 1 } };
  },
}));

let owner: TestOwner;
let ana: { id: string };
let bia: { id: string };
let ai: typeof import("@/lib/actions/ai");
let ctx: typeof import("@/lib/ai/context");

const membro = (id: string, role: string) => ({
  id, name: role, email: `${id}@b2c.local`, role, permissions: [], personId: null,
  workspaceOwnerId: owner.id,
});

function comoUsuario<T>(v: any, fn: () => Promise<T>): Promise<T> {
  estado.viewer = v;
  return asOwner(owner, fn);
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  owner = await createOwner();
  const criar = (role: string) =>
    runWithoutScope(async () =>
      prisma.user.create({
        data: {
          name: role, email: `${role}-${randomUUID()}@b2c.local`, passwordHash: "x",
          role, workspaceOwnerId: owner.id,
        },
        select: { id: true },
      })
    );
  ana = await criar("GESTOR");
  bia = await criar("COBRANCA");
  ai = await import("@/lib/actions/ai");
  ctx = await import("@/lib/ai/context");
});

afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.aIConversation.deleteMany({ where: { ownerId: owner.id } });
    await prisma.aIMemory.deleteMany({ where: { ownerId: owner.id } });
    await prisma.transaction.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
  });
  await destroyOwner(owner);
});

describe("A1 — conversas privadas por usuário", () => {
  it("colega não continua a conversa alheia pelo id", async () => {
    const r1 = await comoUsuario(membro(ana.id, "GESTOR"), () => ai.sendChatMessage(null, "minha pergunta"));
    expect(r1.ok).toBe(true);
    const convAna = (r1 as any).conversationId as string;

    const r2 = await comoUsuario(membro(bia.id, "COBRANCA"), () => ai.sendChatMessage(convAna, "invasão"));
    expect(r2.ok).toBe(true);
    expect((r2 as any).conversationId).not.toBe(convAna);

    const msgs = await runWithoutScope(async () =>
      prisma.aIMessage.findMany({ where: { conversationId: convAna } })
    );
    expect(msgs.map((m) => m.content)).not.toContain("invasão");

    const conv = await runWithoutScope(async () =>
      prisma.aIConversation.findUniqueOrThrow({ where: { id: convAna } })
    );
    expect(conv.userId).toBe(ana.id);
  });

  it("o dono da conversa continua a própria", async () => {
    const r1 = await comoUsuario(membro(ana.id, "GESTOR"), () => ai.sendChatMessage(null, "outra"));
    const id = (r1 as any).conversationId;
    const r2 = await comoUsuario(membro(ana.id, "GESTOR"), () => ai.sendChatMessage(id, "seguindo"));
    expect((r2 as any).conversationId).toBe(id);
  });
});

describe("A1 — memórias privadas por usuário", () => {
  it("colega não lê, não fixa e não apaga a memória alheia", async () => {
    await comoUsuario(membro(ana.id, "GESTOR"), () => ai.addMemory(form({ content: "segredo da Ana" })));
    const mem = await runWithoutScope(async () =>
      prisma.aIMemory.findFirstOrThrow({ where: { ownerId: owner.id, content: "segredo da Ana" } })
    );
    expect(mem.userId).toBe(ana.id);

    const vBia = membro(bia.id, "COBRANCA");
    const textoBia = await comoUsuario(vBia, () => ctx.loadMemoryText(vBia));
    expect(textoBia).not.toContain("segredo da Ana");

    await comoUsuario(vBia, () => ai.toggleMemoryPin(mem.id));
    await comoUsuario(vBia, () => ai.deleteMemory(mem.id));
    const depois = await runWithoutScope(async () => prisma.aIMemory.findUnique({ where: { id: mem.id } }));
    expect(depois).not.toBeNull();
    expect(depois!.pinned).toBe(false);

    const vAna = membro(ana.id, "GESTOR");
    expect(await comoUsuario(vAna, () => ctx.loadMemoryText(vAna))).toContain("segredo da Ana");
    await comoUsuario(vAna, () => ai.toggleMemoryPin(mem.id));
    const fixada = await runWithoutScope(async () => prisma.aIMemory.findUnique({ where: { id: mem.id } }));
    expect(fixada!.pinned).toBe(true);
  });

  it("memória legada (sem autor) só o ADMIN enxerga", async () => {
    await asOwner(owner, async () =>
      prisma.aIMemory.create({ data: { content: "legado antigo", kind: "note" } })
    );
    const vBia = membro(bia.id, "COBRANCA");
    expect(await comoUsuario(vBia, () => ctx.loadMemoryText(vBia))).not.toContain("legado antigo");
    const vAdmin = { ...membro(owner.id, "ADMIN"), workspaceOwnerId: null };
    expect(await comoUsuario(vAdmin, () => ctx.loadMemoryText(vAdmin))).toContain("legado antigo");
  });
});

describe("A2 — retrato recortado pelas permissões", () => {
  beforeAll(async () => {
    const hoje = new Date();
    await asOwner(owner, async () => {
      await prisma.transaction.create({
        data: { date: hoje, description: "DESPESA-VISIVEL", amount: 100, type: "despesa", status: "pago" },
      });
      await prisma.transaction.create({
        data: {
          date: hoje, description: "FOLHA-SECRETA", amount: 9000, type: "despesa",
          status: "pago", expenseType: "PAYROLL",
        },
      });
    });
  });

  it("COBRANCA não recebe despesas, caixa nem saúde financeira", async () => {
    estado.prompts = [];
    await comoUsuario(membro(bia.id, "COBRANCA"), () => ai.sendChatMessage(null, "como estou?"));
    const p = estado.prompts[0];
    expect(p).not.toContain("DESPESA-VISIVEL");
    expect(p).not.toContain("FOLHA-SECRETA");
    expect(p).not.toMatch(/em caixa R\$/);
    expect(p).not.toMatch(/despesas R\$/);
    expect(p).not.toContain("SAÚDE:");
    // recebimentos.visualizar ela tem:
    expect(p).toMatch(/a receber R\$/);
  });

  it("GESTOR vê despesas, mas não os lançamentos de folha", async () => {
    estado.prompts = [];
    await comoUsuario(membro(ana.id, "GESTOR"), () => ai.sendChatMessage(null, "e as despesas?"));
    const p = estado.prompts[0];
    expect(p).toContain("DESPESA-VISIVEL");
    expect(p).not.toContain("FOLHA-SECRETA");
    expect(p).toMatch(/em caixa R\$/);
  });

  it("com folha.visualizar concedida, a folha aparece", async () => {
    estado.prompts = [];
    const v = {
      ...membro(ana.id, "GESTOR"),
      permissions: [{ permission: "folha.visualizar", enabled: true }],
    };
    await comoUsuario(v, () => ai.sendChatMessage(null, "e a folha?"));
    expect(estado.prompts[0]).toContain("FOLHA-SECRETA");
  });
});
