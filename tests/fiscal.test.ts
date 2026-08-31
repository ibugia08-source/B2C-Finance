import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { cancelarNota, notasDa, notasDoMes, registrarNota } from "@/lib/services/fiscal";
import { resumoDoFechamento } from "@/lib/services/closing-checklist";

/**
 * F3.6 — registro OPCIONAL de nota (01 §4.7; decisão 19.38).
 *
 * O teste mais importante deste arquivo é o último: o checklist de fechamento
 * NÃO pode ganhar pendência fiscal. A direção decidiu que a maioria dos
 * serviços não emite nota, e construir a cobrança que ela decidiu não ter
 * seria pior que não construir nada — alguém acabaria ligando.
 */
describe("F3.6 — nota fiscal como registro", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("registra e liga à cobrança", async () => {
    const c = await createMrrClient(dono, { name: "Com nota" });
    const cob = await createBilling(dono, c.id, { month: 2, year: 2027, amount: 1500 });

    const r: any = await asOwner(dono, async () =>
      registrarNota({
        billingId: cob.id, clientId: c.id, number: "000123",
        issuedAt: new Date(2027, 1, 10), amount: 1500,
      })
    );
    expect(r.ok).toBe(true);

    const notas = await asOwner(dono, async () => notasDa(cob.id));
    expect(notas).toHaveLength(1);
    expect(notas[0].number).toBe("000123");
  });

  it("a mesma nota duas vezes recebe aviso amigável, não erro de banco", async () => {
    const r = await asOwner(dono, async () =>
      registrarNota({ number: "000123", issuedAt: new Date(2027, 1, 11), amount: 100 })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/já está registrada/i);
  });

  it("cancelar NÃO apaga — a nota cancelada continua existindo no mundo real", async () => {
    const doc = await asOwner(dono, async () =>
      prisma.fiscalDocument.findFirstOrThrow({ where: { number: "000123" } })
    );
    const r = await asOwner(dono, async () =>
      cancelarNota(doc.id, "emitida com o valor errado")
    );
    expect(r.ok).toBe(true);

    const depois = await asOwner(dono, async () =>
      prisma.fiscalDocument.findUniqueOrThrow({ where: { id: doc.id } })
    );
    expect(depois.status).toBe("CANCELLED");
    expect(depois.cancelledAt).toBeTruthy();
    // O contador precisa ver a cancelada para entender por que o número pulou.
    expect(depois.number).toBe("000123");
  });

  it("cancelada sai do total do mês", async () => {
    const { total } = await asOwner(dono, async () => notasDoMes("2027-02"));
    expect(total).toBe(0);
  });

  it("cancelada SEM data é recusada pelo banco", async () => {
    await expect(
      runWithoutScope(async () =>
        prisma.$executeRawUnsafe(
          `UPDATE "FiscalDocument" SET "cancelledAt"=NULL WHERE number='000123'`
        )
      )
    ).rejects.toThrow();
  });

  it("o fechamento NÃO ganha pendência fiscal (19.38)", async () => {
    const r = await asOwner(dono, async () => resumoDoFechamento("2027-02"));
    const fiscal = r.itens.find((i) => i.id === "fiscal")!;
    // Continua "não medido", com o motivo escrito — construir a cobrança que
    // a direção decidiu não ter seria pior do que não construir nada.
    expect(fiscal.situacao).toBe("NAO_MEDIDO");
    expect(fiscal.detalhe).toMatch(/19\.38|OPCIONAL|opcional/);
  });
});
