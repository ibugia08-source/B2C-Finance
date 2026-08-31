import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createMrrClient, createOwner, createRelationship, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import { currentTerm, openTerm, termAt, termHistory } from "@/lib/services/commercial-term";

/**
 * F1.2 — CommercialTerm como FONTE TEMPORAL (01 §4.4).
 *
 * O teste que importa é o do reajuste: depois de mudar o valor, a
 * pergunta "quanto valia em março?" tem de continuar respondendo o valor
 * ANTIGO. É exatamente isso que o v1 perdia ao sobrescrever
 * Client.monthlyValue.
 */
describe("F1.2 — termo comercial", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("o reajuste NÃO apaga o passado", async () => {
    const cliente = await createMrrClient(dono, { name: "Reajustado" });
    const rel = await createRelationship(dono, cliente.id);

    await asOwner(dono, async () =>
      openTerm({
        relationshipId: rel.id,
        modality: "MRR",
        monthlyValue: 1000,
        validFrom: new Date(2026, 0, 1),
        reason: "Contrato inicial",
      })
    );
    await asOwner(dono, async () =>
      openTerm({
        relationshipId: rel.id,
        modality: "MRR",
        monthlyValue: 1500,
        validFrom: new Date(2026, 5, 1),
        reason: "Reajuste",
      })
    );

    const emMarco = await asOwner(dono, async () => termAt(rel.id, new Date(2026, 2, 15)));
    const emJulho = await asOwner(dono, async () => termAt(rel.id, new Date(2026, 6, 15)));

    expect(Number(emMarco?.monthlyValue)).toBe(1000);
    expect(Number(emJulho?.monthlyValue)).toBe(1500);
  });

  it("só existe UM termo vigente por vez", async () => {
    const cliente = await createMrrClient(dono, { name: "Um vigente" });
    const rel = await createRelationship(dono, cliente.id);

    for (const [valor, mes] of [[800, 0], [900, 3], [1100, 8]] as const) {
      await asOwner(dono, async () =>
        openTerm({
          relationshipId: rel.id,
          modality: "MRR",
          monthlyValue: valor,
          validFrom: new Date(2026, mes, 1),
        })
      );
    }

    const abertos = await asOwner(dono, async () =>
      prisma.commercialTerm.count({ where: { relationshipId: rel.id, validTo: null } })
    );
    expect(abertos).toBe(1);

    const vigente = await asOwner(dono, async () => currentTerm(rel.id));
    expect(Number(vigente?.monthlyValue)).toBe(1100);

    // O cache da relação acompanha.
    const r = await asOwner(dono, async () =>
      prisma.clientAgencyRelationship.findUniqueOrThrow({ where: { id: rel.id } })
    );
    expect(r.currentCommercialTermId).toBe(vigente?.id);
  });

  it("antes do primeiro termo não existe valor — e o sistema diz isso", async () => {
    const cliente = await createMrrClient(dono, { name: "Sem termo antes" });
    const rel = await createRelationship(dono, cliente.id);
    await asOwner(dono, async () =>
      openTerm({
        relationshipId: rel.id,
        modality: "MRR",
        monthlyValue: 500,
        validFrom: new Date(2026, 5, 1),
      })
    );

    const antes = await asOwner(dono, async () => termAt(rel.id, new Date(2026, 0, 1)));
    expect(antes).toBeNull();
  });

  it("o histórico devolve a linha do tempo, do mais novo ao mais antigo", async () => {
    const cliente = await createMrrClient(dono, { name: "Histórico" });
    const rel = await createRelationship(dono, cliente.id);
    await asOwner(dono, async () =>
      openTerm({ relationshipId: rel.id, modality: "MRR", monthlyValue: 300, validFrom: new Date(2026, 0, 1) })
    );
    await asOwner(dono, async () =>
      openTerm({ relationshipId: rel.id, modality: "TCV", totalContractValue: 12000, validFrom: new Date(2026, 6, 1), reason: "Virou projeto fechado" })
    );

    const hist = await asOwner(dono, async () => termHistory(rel.id));
    expect(hist).toHaveLength(2);
    expect(hist[0].modality).toBe("TCV");
    expect(hist[1].modality).toBe("MRR");
    expect(hist[1].validTo).not.toBeNull();
  });
});
