import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwner, createMrrClient, createOwner, destroyOwner, prisma, type TestOwner } from "./support/db";
import { assertReason, auditEvent, auditTrail, auditUpdate } from "@/lib/audit";

/**
 * F1.9 — trilha de auditoria (01 §4.10).
 *
 * O teste que vale por todos é o do append-only: a trava tem de estar no
 * BANCO, não na aplicação. Trilha que o próprio sistema consegue reescrever
 * não é trilha, é rascunho — e o teste prova que nem o Prisma passa.
 */
describe("F1.9 — trilha de auditoria", () => {
  let dono: TestOwner;
  let clienteId: string;

  beforeAll(async () => {
    dono = await createOwner();
    const c = await createMrrClient(dono, { name: "Auditado" });
    clienteId = c.id;
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("registra só o que MUDOU, campo a campo", async () => {
    const n = await asOwner(dono, async () =>
      auditUpdate(
        prisma, "Client", clienteId,
        { name: "Antes", monthlyValue: 1000, segment: "varejo" },
        { name: "Depois", monthlyValue: 1000, segment: "serviços" },
        { reason: "Reajuste combinado", actorEmail: "gestor@b2c.local" }
      )
    );
    // monthlyValue não mudou: registrar campo igual encheria a trilha de ruído.
    expect(n).toBe(2);

    const linhas = await asOwner(dono, async () => auditTrail("Client", clienteId));
    const campos = linhas.map((l) => l.field).sort();
    expect(campos).toEqual(["name", "segment"]);
    expect(linhas.every((l) => l.reason === "Reajuste combinado")).toBe(true);
    expect(linhas.every((l) => l.actorEmail === "gestor@b2c.local")).toBe(true);
  });

  it("ignora campos de infraestrutura e segredo", async () => {
    const n = await asOwner(dono, async () =>
      auditUpdate(
        prisma, "User", "u1",
        { updatedAt: new Date(2026, 0, 1), passwordHash: "a" },
        { updatedAt: new Date(2026, 5, 1), passwordHash: "b" }
      )
    );
    expect(n).toBe(0);
  });

  it("o BANCO recusa alterar ou apagar uma linha da trilha", async () => {
    await asOwner(dono, async () =>
      auditEvent(prisma, "Billing", "b-append-only", "REVERSE", { reason: "teste" })
    );
    const linha = await asOwner(dono, async () =>
      prisma.auditLog.findFirstOrThrow({ where: { entityId: "b-append-only" } })
    );

    await expect(
      asOwner(dono, async () =>
        prisma.auditLog.update({ where: { id: linha.id }, data: { reason: "adulterado" } })
      )
    ).rejects.toThrow(/append-only/i);

    await expect(
      asOwner(dono, async () => prisma.auditLog.delete({ where: { id: linha.id } }))
    ).rejects.toThrow(/append-only/i);

    // E continua lá, intacta.
    const ainda = await asOwner(dono, async () =>
      prisma.auditLog.findUniqueOrThrow({ where: { id: linha.id } })
    );
    expect(ainda.reason).toBe("teste");
  });

  it("estorno e exclusão exigem motivo", () => {
    expect(() => assertReason("REVERSE", null)).toThrow(/motivo/i);
    expect(() => assertReason("DELETE", "   ")).toThrow(/motivo/i);
    expect(() => assertReason("REVERSE", "cliente pediu")).not.toThrow();
    // Criação não exige.
    expect(() => assertReason("CREATE", null)).not.toThrow();
  });

  it("a trilha não vaza entre donos", async () => {
    const outro = await createOwner();
    const vistas = await asOwner(outro, async () => auditTrail("Client", clienteId));
    expect(vistas).toHaveLength(0);
    await destroyOwner(outro);
  });
});
