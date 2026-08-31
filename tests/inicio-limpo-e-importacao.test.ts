import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createMrrClient, createOwner, destroyOwner, prisma, type TestOwner,
} from "./support/db";
import { abrirVidaDoCliente } from "@/lib/services/client-lifecycle";
import { encerrarPendencia, filaDeRevisao, proveniencia } from "@/lib/services/import-review";
import { getImportDef } from "@/lib/imports/definitions";

/**
 * F1.21 — início zerado e entrada de dados reais.
 *
 * A tarefa foi REESCRITA pela decisão 19.32 (não há migração do v1). O que
 * ela protege agora é a porta de entrada: cliente que entra por planilha tem
 * de nascer tão completo quanto o que entra pela tela, e a linha duvidosa tem
 * de sobrar visível em vez de virar número oficial calada.
 */

describe("F1.21 — o cliente nasce completo, venha de onde vier", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("relação, termo e onboarding saem juntos", async () => {
    const c = await createMrrClient(dono, { name: "Nasce completo", monthlyValue: 2500 });
    const r = await asOwner(dono, async () =>
      abrirVidaDoCliente(c.id, { status: "ACTIVE", monthlyValue: 2500, modality: "MRR" })
    );

    expect(r.relationshipId).toBeTruthy();
    expect(r.termoAberto).toBe(true);
    expect(r.onboardingIniciado).toBe(true);
    expect(r.faltou).toEqual([]);

    const termo = await asOwner(dono, async () =>
      prisma.commercialTerm.findFirst({
        where: { relationshipId: r.relationshipId!, validTo: null },
      })
    );
    expect(Number(termo!.monthlyValue)).toBe(2500);

    const tarefas = await asOwner(dono, async () =>
      prisma.onboardingTask.count({ where: { relationshipId: r.relationshipId! } })
    );
    expect(tarefas).toBeGreaterThan(0);
  });

  it("reimportar a mesma planilha não duplica relação nem termo", async () => {
    const c = await createMrrClient(dono, { name: "Importado duas vezes", monthlyValue: 1000 });
    const a = await asOwner(dono, async () =>
      abrirVidaDoCliente(c.id, { status: "ACTIVE", monthlyValue: 1000 })
    );
    const b = await asOwner(dono, async () =>
      abrirVidaDoCliente(c.id, { status: "ACTIVE", monthlyValue: 1000 })
    );
    expect(b.relationshipId).toBe(a.relationshipId);

    const relacoes = await asOwner(dono, async () =>
      prisma.clientAgencyRelationship.count({ where: { clientId: c.id } })
    );
    const termos = await asOwner(dono, async () =>
      prisma.commercialTerm.count({ where: { relationshipId: a.relationshipId! } })
    );
    expect(relacoes).toBe(1);
    expect(termos).toBe(1);
  });

  it("cliente ativo SEM valor não ganha termo de R$ 0 — vira pendência", async () => {
    // Abrir termo com zero criaria um histórico dizendo "este cliente valia
    // R$ 0,00 em setembro", que é exatamente a mentira que o histórico de
    // preço existe para evitar.
    const c = await createMrrClient(dono, { name: "Ativo sem valor", monthlyValue: 0 });
    const r = await asOwner(dono, async () =>
      abrirVidaDoCliente(c.id, { status: "ACTIVE", monthlyValue: 0 })
    );
    expect(r.termoAberto).toBe(false);
    expect(r.faltou.join(" ")).toMatch(/sem valor/i);

    const termos = await asOwner(dono, async () =>
      prisma.commercialTerm.count({ where: { relationshipId: r.relationshipId! } })
    );
    expect(termos).toBe(0);
  });
});

describe("F1.21 — fila de revisão (03 §3.3)", () => {
  let dono: TestOwner;
  let batchId: string;

  beforeAll(async () => {
    dono = await createOwner();
    batchId = await asOwner(dono, async () => {
      const b = await prisma.importBatch.create({
        data: { source: "xlsx", module: "clientes", fileName: "carteira.xlsx", total: 2 },
        select: { id: true },
      });
      return b.id;
    });
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("a definição de clientes marca ativo sem valor para conferência", () => {
    const def = getImportDef("clientes")!;
    expect(def.revisar!({ status: "ACTIVE", monthlyValue: 0 })).toMatch(/sem valor mensal/);
    expect(def.revisar!({ status: "ACTIVE", monthlyValue: 2500, paymentDay: 5 })).toBeNull();
    // Prospect não precisa de valor — cobrar preço de quem ainda não fechou
    // encheria a fila de ruído e ninguém olharia mais nenhuma linha.
    expect(def.revisar!({ status: "PROSPECT", monthlyValue: 0 })).toBeNull();
  });

  it("a linha entra marcada, com a linha crua guardada ao lado", async () => {
    await asOwner(dono, async () =>
      prisma.importedRecord.create({
        data: {
          batchId, entity: "clientes", entityId: null, sourceRow: 7,
          raw: { name: "Empresa Sem Valor", monthlyValue: 0 },
          confidence: 50, reviewStatus: "PENDENTE",
          reviewReason: "cliente ativo sem valor mensal",
        },
      })
    );

    const fila = await asOwner(dono, async () => filaDeRevisao());
    const item = fila.find((f) => f.sourceRow === 7);
    expect(item).toBeTruthy();
    expect(item!.rotulo).toBe("Empresa Sem Valor");
    expect(item!.arquivo).toBe("carteira.xlsx");
  });

  it('"arrumei" e "está certo assim" ficam gravados diferentes', async () => {
    const rec = await asOwner(dono, async () =>
      prisma.importedRecord.create({
        data: {
          batchId, entity: "clientes", sourceRow: 9, raw: { name: "Decidido" },
          reviewStatus: "PENDENTE", reviewReason: "sem dia de pagamento",
        },
        select: { id: true },
      })
    );
    await asOwner(dono, async () => encerrarPendencia(rec.id, "DESCARTADO", "Israel"));
    const depois = await asOwner(dono, async () =>
      prisma.importedRecord.findUniqueOrThrow({ where: { id: rec.id } })
    );
    expect(depois.reviewStatus).toBe("DESCARTADO");
    expect(depois.resolvedBy).toBe("Israel");
    expect(depois.resolvedAt).toBeTruthy();
  });

  it("o banco recusa estado de revisão inventado", async () => {
    await expect(
      asOwner(dono, async () =>
        prisma.importedRecord.create({
          data: {
            batchId, entity: "clientes", sourceRow: 11, raw: {},
            reviewStatus: "TALVEZ",
          },
        })
      )
    ).rejects.toThrow();
  });

  it("dá para responder de qual arquivo e de qual linha veio um registro", async () => {
    const c = await createMrrClient(dono, { name: "Com proveniência" });
    await asOwner(dono, async () =>
      prisma.importedRecord.create({
        data: {
          batchId, entity: "clientes", entityId: c.id, sourceRow: 42,
          raw: { name: "Com proveniência" },
        },
      })
    );
    const p = await asOwner(dono, async () => proveniencia("clientes", c.id));
    expect(p!.sourceRow).toBe(42);
    expect(p!.sourceSystem).toBe("PLANILHA");
    expect(p!.batch.fileName).toBe("carteira.xlsx");
  });
});
