import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, createOwner, destroyOwner, createMrrClient, asOwner, type TestOwner } from "./support/db";
import { parseReportQuery } from "@/lib/reports/query";
import { clientesReport } from "@/lib/reports/definitions/clientes";
import { responsaveisCadastrados, opcoesDaCarteira, mergeNames } from "@/lib/reports/options";

/**
 * RELATÓRIO DE CLIENTES — filtros combináveis (nicho, modalidade, origem,
 * UF, mês de renovação) e responsável escolhido de LISTA (24/09/2026).
 */

let owner: TestOwner;

beforeAll(async () => {
  owner = await createOwner();
  const mk = async (name: string, data: Record<string, unknown>) => {
    const c = await createMrrClient(owner, { name });
    await asOwner(owner, async () => prisma.client.update({ where: { id: c.id }, data }));
  };
  await mk("Clínica A", { segment: "Clínica", modality: "MRR", origin: "Indicação", state: "BA", salesOwner: "Ana Paula", renewalMonth: 3 });
  await mk("Clínica B", { segment: "Clínica", modality: "TCV", origin: "Tráfego", state: "SP", salesOwner: "Bruno", opsOwner: "Ana Paula", renewalMonth: 9, monthlyValue: null, totalContractValue: 9000 });
  await mk("Loja C", { segment: "Varejo", modality: "MRR", origin: "Indicação", state: "ba", salesOwner: "ana paula", renewalMonth: 3 });
  await asOwner(owner, async () =>
    prisma.employee.create({ data: { name: "Carla", active: true } })
  );
  await asOwner(owner, async () =>
    prisma.employee.create({ data: { name: "Antigo", active: false } })
  );
});
afterAll(async () => {
  await destroyOwner(owner);
});

describe("parseReportQuery", () => {
  it("lê os filtros novos da URL e ignora valores inválidos", () => {
    const q = parseReportQuery({
      modalidade: "TCV", segmento: "Clínica", origem: "Tráfego", uf: "sp", mesRenovacao: "9",
    });
    expect(q.modalidade).toBe("TCV");
    expect(q.segmento).toBe("Clínica");
    expect(q.origem).toBe("Tráfego");
    expect(q.uf).toBe("SP");
    expect(q.mesRenovacao).toBe(9);
    const ruim = parseReportQuery({ modalidade: "XYZ", mesRenovacao: "13" });
    expect(ruim.modalidade).toBeUndefined();
    expect(ruim.mesRenovacao).toBeUndefined();
  });
});

describe("relatório de clientes", () => {
  const nomes = async (sp: Record<string, string>) =>
    (await asOwner(owner, async () => clientesReport.build(parseReportQuery(sp))))
      .map((r) => r.cliente)
      .sort();

  it("filtra por nicho", async () => {
    expect(await nomes({ segmento: "Clínica" })).toEqual(["Clínica A", "Clínica B"]);
  });
  it("combina nicho + modalidade + origem", async () => {
    expect(await nomes({ segmento: "Clínica", modalidade: "MRR" })).toEqual(["Clínica A"]);
    expect(await nomes({ origem: "Indicação", modalidade: "MRR" })).toEqual(["Clínica A", "Loja C"]);
    expect(await nomes({ segmento: "Varejo", modalidade: "TCV" })).toEqual([]);
  });
  it("filtra por UF sem diferenciar caixa e por mês de renovação", async () => {
    expect(await nomes({ uf: "BA" })).toEqual(["Clínica A", "Loja C"]);
    expect(await nomes({ mesRenovacao: "9" })).toEqual(["Clínica B"]);
  });
  it("responsável escolhido da lista casa comercial OU operacional, nome exato", async () => {
    expect(await nomes({ responsavel: "Ana Paula" })).toEqual(["Clínica A", "Clínica B", "Loja C"]);
    // "Ana" sozinha não é um nome cadastrado — não pode casar por pedaço.
    expect(await nomes({ responsavel: "Ana" })).toEqual([]);
    expect(await nomes({ responsavel: "Ana Paula", modalidade: "TCV" })).toEqual(["Clínica B"]);
  });
  it("expõe as colunas novas para agrupar e exportar", async () => {
    const rows = await asOwner(owner, async () => clientesReport.build(parseReportQuery({ cliente: "" })));
    const b = rows.find((r) => r.cliente === "Clínica B")!;
    expect(b.modalidade).toBe("TCV");
    expect(b.segmento).toBe("Clínica");
    expect(b.origem).toBe("Tráfego");
    expect(b.uf).toBe("SP");
    expect(b.mesRenovacao).toBe("Setembro");
    expect(b.responsavelOperacional).toBe("Ana Paula");
    for (const k of ["modalidade", "segmento", "origem", "uf", "mesRenovacao"]) {
      expect(clientesReport.filterFields).toContain(k);
      expect(clientesReport.groupOptions).toContain(k);
    }
  });
});

describe("listas dos filtros", () => {
  it("responsáveis = colaboradores ativos + nomes gravados em clientes, sem repetir", async () => {
    const lista = await asOwner(owner, async () => responsaveisCadastrados());
    expect(lista).toEqual(["Ana Paula", "Bruno", "Carla"]);
  });
  it("nicho, origem e UF vêm do que existe na carteira", async () => {
    const o = await asOwner(owner, async () => opcoesDaCarteira());
    expect(o.segmentos).toEqual(["Clínica", "Varejo"]);
    expect(o.origens).toEqual(["Indicação", "Tráfego"]);
    expect(o.ufs).toEqual(["BA", "SP"]);
  });
  it("mergeNames ignora vazios e duplicatas por caixa", () => {
    expect(mergeNames(["b", " ", null], ["B", "a"])).toEqual(["a", "b"]);
  });
});
