import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma, runWithoutScope, createOwner, destroyOwner, asOwner, type TestOwner } from "./support/db";

vi.mock("@/lib/auth/viewer", () => ({
  requirePermission: async () => ({
    id: "teste", name: "Teste", email: "teste@b2c.local",
    role: "ADMIN", permissions: [], personId: null,
  }),
  can: () => true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

let owner: TestOwner;
let salvarConta: typeof import("@/lib/actions/contas")["salvarConta"];

beforeAll(async () => {
  owner = await createOwner();
  ({ salvarConta } = await import("@/lib/actions/contas"));
});
afterAll(async () => {
  await runWithoutScope(async () => prisma.account.deleteMany({ where: { ownerId: owner.id } }));
  await destroyOwner(owner);
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("salvarConta", () => {
  it("cria conta nova com saldo em pt-BR", async () => {
    const res = await asOwner(owner, async () =>
      salvarConta(form({ name: "Nubank PJ", bank: "Nubank", type: "corrente", balance: "1.234,56", active: "true" }))
    );
    expect(res).toEqual(expect.objectContaining({ ok: true }));
    const rows = await asOwner(owner, async () => prisma.account.findMany());
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].balance)).toBe(1234.56);
  });
  it("cria conta sem saldo e sem banco", async () => {
    const res = await asOwner(owner, async () =>
      salvarConta(form({ name: "Caixa físico", type: "dinheiro" }))
    );
    expect(res).toEqual(expect.objectContaining({ ok: true }));
  });
});
