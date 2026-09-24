import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, asOwner, type TestOwner } from "./support/db";
import { nicheSlug, nicheDisplayName, SEM_NICHO } from "@/lib/niches";
import { resolverNicho, listarNichos } from "@/lib/services/niches";
import { parseReportQuery } from "@/lib/reports/query";
import { clientesReport } from "@/lib/reports/definitions/clientes";

/**
 * NICHOS COMO CATÁLOGO (24/09/2026): cadastrado uma vez pelo ADMIN, sem
 * duplicata, escolhido de lista no cadastro, com "Sem nicho" nos filtros.
 */

let papel: "ADMIN" | "GESTOR" = "ADMIN";
vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => ({
    id: "teste", name: "Teste", email: "teste@b2c.local", role: papel, permissions: [], personId: null,
  }),
  requirePermission: async () => ({
    id: "teste", name: "Teste", email: "teste@b2c.local", role: papel, permissions: [], personId: null,
  }),
  tryPermission: async () => ({
    id: "teste", name: "Teste", email: "teste@b2c.local", role: papel, permissions: [], personId: null,
  }),
  NO_PERMISSION: { ok: false, error: "Sem permissão." },
  can: () => true,
}));
vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {}, revalidateFinance: () => {}, revalidateClients: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

let owner: TestOwner;
let acoes: typeof import("@/lib/actions/niches");
let saveClient: typeof import("@/lib/actions/clients")["saveClient"];

beforeAll(async () => {
  owner = await createOwner();
  acoes = await import("@/lib/actions/niches");
  ({ saveClient } = await import("@/lib/actions/clients"));
});
afterAll(async () => {
  await destroyOwner(owner);
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("normalização", () => {
  it("mesmo nicho independe de caixa e espaços", () => {
    expect(nicheSlug("  Clínica   Odontológica ")).toBe("clínica odontológica");
    expect(nicheSlug("CLÍNICA ODONTOLÓGICA")).toBe(nicheSlug("clínica odontológica"));
    expect(nicheDisplayName("  Moda  /  Varejo ")).toBe("Moda / Varejo");
  });
});

describe("catálogo (ADMIN)", () => {
  it("cadastra uma vez e recusa duplicata por grafia", async () => {
    const r1 = await asOwner(owner, async () => acoes.salvarNicho(form({ name: " Imobiliária " })));
    expect(r1.ok).toBe(true);
    const r2 = await asOwner(owner, async () => acoes.salvarNicho(form({ name: "IMOBILIÁRIA" })));
    expect(r2.ok).toBe(false);
    expect((r2 as any).error).toMatch(/Já existe/);
    const lista = await asOwner(owner, async () => listarNichos());
    expect(lista.map((n) => n.name)).toEqual(["Imobiliária"]);
  });

  it("renomear propaga para o texto dos clientes", async () => {
    const [n] = await asOwner(owner, async () => listarNichos());
    const c = await createMrrClient(owner, { name: "Imob A" });
    await asOwner(owner, async () =>
      prisma.client.update({ where: { id: c.id }, data: { nicheId: n.id, segment: n.name } })
    );
    const r = await asOwner(owner, async () => acoes.salvarNicho(form({ id: n.id, name: "Imobiliário" })));
    expect(r.ok).toBe(true);
    const cli = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { segment: true, nicheId: true } })
    );
    expect(cli).toEqual({ segment: "Imobiliário", nicheId: n.id });
  });

  it("mesclar move os clientes e apaga o nicho de origem", async () => {
    const dup = await asOwner(owner, async () => acoes.salvarNicho(form({ name: "Imobiliaria" })));
    expect(dup.ok).toBe(true);
    const dupId = (dup as any).id as string;
    const c = await createMrrClient(owner, { name: "Imob B" });
    await asOwner(owner, async () =>
      prisma.client.update({ where: { id: c.id }, data: { nicheId: dupId, segment: "Imobiliaria" } })
    );
    const alvo = (await asOwner(owner, async () => listarNichos())).find((n) => n.name === "Imobiliário")!;
    const r = await asOwner(owner, async () => acoes.mesclarNichos(dupId, alvo.id));
    expect(r.ok).toBe(true);
    const cli = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { segment: true, nicheId: true } })
    );
    expect(cli).toEqual({ segment: "Imobiliário", nicheId: alvo.id });
    expect((await asOwner(owner, async () => listarNichos())).map((n) => n.name)).toEqual(["Imobiliário"]);
  });

  it("excluir deixa os clientes 'Sem nicho'", async () => {
    const r0 = await asOwner(owner, async () => acoes.salvarNicho(form({ name: "Temporário" })));
    const id = (r0 as any).id as string;
    const c = await createMrrClient(owner, { name: "Temp C" });
    await asOwner(owner, async () =>
      prisma.client.update({ where: { id: c.id }, data: { nicheId: id, segment: "Temporário" } })
    );
    const r = await asOwner(owner, async () => acoes.excluirNicho(id));
    expect(r.ok).toBe(true);
    const cli = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { segment: true, nicheId: true } })
    );
    expect(cli).toEqual({ segment: null, nicheId: null });
  });

  it("quem não é ADMIN não altera o catálogo, mas lê a lista", async () => {
    papel = "GESTOR";
    try {
      const r = await asOwner(owner, async () => acoes.salvarNicho(form({ name: "Novo" })));
      expect(r.ok).toBe(false);
      expect((r as any).error).toMatch(/administrador/);
      const lista = await asOwner(owner, async () => acoes.listNicheOptions());
      expect(lista.map((n) => n.name)).toEqual(["Imobiliário"]);
    } finally {
      papel = "ADMIN";
    }
  });
});

describe("cadastro e importação", () => {
  it("saveClient grava nicho da lista e recusa id fora do catálogo", async () => {
    const [n] = await asOwner(owner, async () => listarNichos());
    const ok = await asOwner(owner, async () =>
      saveClient(form({ name: "Cliente Nicho", status: "PROSPECT", nicheId: n.id }))
    );
    expect(ok.ok).toBe(true);
    const cli = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: (ok as any).id }, select: { segment: true, nicheId: true } })
    );
    expect(cli).toEqual({ segment: "Imobiliário", nicheId: n.id });

    const ruim = await asOwner(owner, async () =>
      saveClient(form({ name: "Cliente X", status: "PROSPECT", nicheId: "nao-existe" }))
    );
    expect(ruim.ok).toBe(false);
  });

  it("resolverNicho casa pelo slug e só cria quando pedido", async () => {
    const achado = await asOwner(owner, async () => resolverNicho("  imobiliário "));
    expect(achado?.name).toBe("Imobiliário");
    expect(await asOwner(owner, async () => resolverNicho("Pet shop"))).toBeNull();
    const criado = await asOwner(owner, async () => resolverNicho("Pet shop", { criar: true }));
    expect(criado?.name).toBe("Pet shop");
    const deNovo = await asOwner(owner, async () => resolverNicho("PET SHOP", { criar: true }));
    expect(deNovo?.id).toBe(criado?.id);
    expect(await asOwner(owner, async () => resolverNicho("   ", { criar: true }))).toBeNull();
  });
});

describe("filtro 'Sem nicho' no relatório", () => {
  it("devolve só quem não tem nicho", async () => {
    const rows = await asOwner(owner, async () =>
      clientesReport.build(parseReportQuery({ segmento: SEM_NICHO }))
    );
    const nomes = rows.map((r) => r.cliente);
    expect(nomes).toContain("Temp C");
    expect(nomes).not.toContain("Cliente Nicho");
    expect(rows.every((r) => r.segmento == null)).toBe(true);
  });
});
