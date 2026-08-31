import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createMrrClient, createOwner, createRelationship, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import {
  assignManager, assignmentHistory, currentManagers, managersAt,
} from "@/lib/services/client-managers";

/**
 * F1.3 — vigência de gestores (01 §4.3).
 *
 * O teste central é o mesmo do termo comercial: trocar o gestor NÃO pode
 * apagar quem respondia pela conta antes. Sem isso, apuração de comissão e
 * carteira por gestor mentem sobre o passado.
 */
describe("F1.3 — gestores por vigência", () => {
  let dono: TestOwner;
  let ana: { id: string };
  let bruno: { id: string };

  beforeAll(async () => {
    dono = await createOwner();
    [ana, bruno] = await asOwner(dono, async () => [
      await prisma.employee.create({ data: { name: "Ana Gestora" }, select: { id: true } }),
      await prisma.employee.create({ data: { name: "Bruno Gestor" }, select: { id: true } }),
    ]);
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("trocar de gestor não apaga quem cuidava antes", async () => {
    const cliente = await createMrrClient(dono, { name: "Trocou de gestor" });
    const rel = await createRelationship(dono, cliente.id);

    await asOwner(dono, async () =>
      assignManager({ relationshipId: rel.id, managerId: ana.id, role: "MANAGER_1", validFrom: new Date(2026, 0, 1) })
    );
    await asOwner(dono, async () =>
      assignManager({
        relationshipId: rel.id, managerId: bruno.id, role: "MANAGER_1",
        validFrom: new Date(2026, 5, 1), reason: "Redistribuição de carteira",
      })
    );

    const emMarco = await asOwner(dono, async () => managersAt(rel.id, new Date(2026, 2, 10)));
    const emJulho = await asOwner(dono, async () => managersAt(rel.id, new Date(2026, 6, 10)));

    expect(emMarco.map((a) => a.manager.name)).toEqual(["Ana Gestora"]);
    expect(emJulho.map((a) => a.manager.name)).toEqual(["Bruno Gestor"]);
  });

  it("um papel tem no máximo um titular aberto", async () => {
    const cliente = await createMrrClient(dono, { name: "Um titular" });
    const rel = await createRelationship(dono, cliente.id);
    for (const [quem, mes] of [[ana.id, 0], [bruno.id, 2], [ana.id, 7]] as const) {
      await asOwner(dono, async () =>
        assignManager({ relationshipId: rel.id, managerId: quem, role: "MANAGER_1", validFrom: new Date(2026, mes, 1) })
      );
    }
    const abertos = await asOwner(dono, async () =>
      prisma.clientManagerAssignment.count({
        where: { relationshipId: rel.id, role: "MANAGER_1", validTo: null },
      })
    );
    expect(abertos).toBe(1);

    const hist = await asOwner(dono, async () => assignmentHistory(rel.id, "MANAGER_1"));
    expect(hist).toHaveLength(3);
  });

  it("papéis diferentes convivem ao mesmo tempo", async () => {
    const cliente = await createMrrClient(dono, { name: "Dois papéis" });
    const rel = await createRelationship(dono, cliente.id);
    await asOwner(dono, async () => {
      await assignManager({ relationshipId: rel.id, managerId: ana.id, role: "MANAGER_1", validFrom: new Date(2026, 0, 1) });
      await assignManager({ relationshipId: rel.id, managerId: bruno.id, role: "COMMERCIAL_ORIGIN", validFrom: new Date(2026, 0, 1) });
    });

    const hoje = await asOwner(dono, async () => currentManagers(rel.id));
    expect(hoje).toHaveLength(2);
    expect(new Set(hoje.map((a) => a.role))).toEqual(new Set(["MANAGER_1", "COMMERCIAL_ORIGIN"]));
  });

  it("antes da primeira atribuição, ninguém respondia — e o sistema não inventa", async () => {
    const cliente = await createMrrClient(dono, { name: "Sem gestor antes" });
    const rel = await createRelationship(dono, cliente.id);
    await asOwner(dono, async () =>
      assignManager({ relationshipId: rel.id, managerId: ana.id, role: "MANAGER_1", validFrom: new Date(2026, 5, 1) })
    );
    const antes = await asOwner(dono, async () => managersAt(rel.id, new Date(2026, 0, 15)));
    expect(antes).toHaveLength(0);
  });
});
