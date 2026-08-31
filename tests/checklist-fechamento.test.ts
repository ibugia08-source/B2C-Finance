import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, createRelationship,
  destroyOwner, prisma, type TestOwner,
} from "./support/db";
import {
  montarChecklist, pendenciasEmTexto, resumoDoFechamento,
} from "@/lib/services/closing-checklist";

/**
 * F2.2 — checklist de fechamento (01 §5.3).
 *
 * O que estes testes protegem não é a contagem de cada item: é a HONESTIDADE
 * da lista. Um checklist que mostra dezesseis verdes num sistema que mede
 * nove faria o dono fechar o mês confiando numa conferência que não
 * aconteceu — seria pior do que não ter checklist.
 */
describe("F2.2 — checklist de fechamento", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("são exatamente os 16 itens de §5.3, numerados de 1 a 16", async () => {
    const itens = await asOwner(dono, async () => montarChecklist("2026-03"));
    expect(itens).toHaveLength(16);
    expect(itens.map((i) => i.numero)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(new Set(itens.map((i) => i.id)).size).toBe(16);
  });

  it("todo item tem dono e explicação — a lista nunca só diz 'faltam 12'", async () => {
    const itens = await asOwner(dono, async () => montarChecklist("2026-03"));
    for (const i of itens) {
      expect(i.dono.length, i.titulo).toBeGreaterThan(0);
      expect(i.detalhe.length, i.titulo).toBeGreaterThan(10);
    }
  });

  it("toda pendência MEDÍVEL tem link para onde se resolve", async () => {
    const itens = await asOwner(dono, async () => montarChecklist("2026-03"));
    // Os itens de razão (15/16) não têm tela própria — são do sistema, não
    // de uma fila de trabalho; o resto tem de levar a algum lugar.
    const semTela = new Set(["ledger", "integridade"]);
    for (const i of itens) {
      if (i.situacao !== "PENDENTE" || semTela.has(i.id)) continue;
      expect(i.href, i.titulo).toBeTruthy();
    }
  });

  it("o que ainda não pode ser medido DIZ isso, em vez de aparecer verde", async () => {
    const r = await asOwner(dono, async () => resumoDoFechamento("2026-03"));
    const naoMedidos = r.itens.filter((i) => i.situacao === "NAO_MEDIDO");
    // Conciliação, rateio, provisão, reserva, fiscal e funil chegam nas
    // fases 3 e 4. Se algum dia isto virar zero sem essas fases existirem,
    // é porque alguém pintou de verde o que não mede.
    expect(naoMedidos.length).toBeGreaterThanOrEqual(6);
    for (const i of naoMedidos) {
      expect(i.detalhe).toMatch(/Fase [34]|desligado|decisão/i);
    }
  });

  it("aprovações não se aplica — e o item diz por quê (19.35/19.36)", async () => {
    const itens = await asOwner(dono, async () => montarChecklist("2026-03"));
    const item = itens.find((i) => i.id === "aprovacoes")!;
    expect(item.situacao).toBe("NAO_SE_APLICA");
    expect(item.detalhe).toMatch(/19\.35/);
  });

  it("cliente de mensalidade sem cobrança no mês vira pendência", async () => {
    const cliente = await createMrrClient(dono, { name: "Sem cobrança em março" });
    const rel = await createRelationship(dono, cliente.id);
    await asOwner(dono, async () =>
      prisma.commercialTerm.create({
        data: {
          relationshipId: rel.id, modality: "MRR", monthlyValue: 1500,
          validFrom: new Date(2026, 0, 1),
        },
      }).then((t) =>
        prisma.clientAgencyRelationship.update({
          where: { id: rel.id },
          data: { currentCommercialTermId: t.id },
        })
      )
    );

    const antes = await asOwner(dono, async () => montarChecklist("2026-03"));
    const item = antes.find((i) => i.id === "mrr-sem-cobranca")!;
    expect(item.situacao).toBe("PENDENTE");
    expect(item.quantidade).toBeGreaterThan(0);

    // Com a cobrança criada, o item fecha.
    await createBilling(dono, cliente.id, { month: 3, year: 2026, amount: 1500 });
    const depois = await asOwner(dono, async () => montarChecklist("2026-03"));
    const item2 = depois.find((i) => i.id === "mrr-sem-cobranca")!;
    expect(item2.quantidade).toBeLessThan(item.quantidade);
  });

  it("o texto que vai para a trilha nomeia cada pendência", async () => {
    const itens = await asOwner(dono, async () => montarChecklist("2026-03"));
    const texto = pendenciasEmTexto(itens);
    const pendentes = itens.filter((i) => i.situacao === "PENDENTE");
    if (pendentes.length === 0) {
      expect(texto).toBe("Checklist sem pendências.");
    } else {
      for (const p of pendentes) expect(texto).toContain(p.titulo);
    }
  });
});
