import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, createRelationship,
  destroyOwner, prisma, type TestOwner,
} from "./support/db";
import {
  carregarGrade, confirmarLinha, confirmarSemMudanca,
} from "@/lib/services/avaliacao-mensal";

/**
 * F1.17 — avaliação mensal em grade (01 §4.13, 02 §4.1).
 *
 * "Custo alvo: 10 min/gestor/mês." Os dois testes centrais saem daí:
 * a linha tem de CHEGAR preenchida com o mês anterior, e tem de existir
 * um gesto que confirme tudo o que não mudou de uma vez. Sem os dois, a
 * grade leva uma hora e não é preenchida — vira dado morto.
 */
const ONTEM = new Date(Date.now() - 86_400_000);

describe("F1.17 — grade de avaliação", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("sugere risco ALTO com 2+ vencidas e MÉDIO com 1 (01 §4.13)", async () => {
    const semAtraso = await createMrrClient(dono, { name: "A Em dia" });
    const umAtraso = await createMrrClient(dono, { name: "B Uma vencida" });
    const doisAtrasos = await createMrrClient(dono, { name: "C Duas vencidas" });
    for (const c of [semAtraso, umAtraso, doisAtrasos]) await createRelationship(dono, c.id);

    await createBilling(dono, umAtraso.id, { month: 1, year: 2026, amount: 100, dueDate: ONTEM });
    await createBilling(dono, doisAtrasos.id, { month: 1, year: 2026, amount: 100, dueDate: ONTEM });
    await createBilling(dono, doisAtrasos.id, { month: 2, year: 2026, amount: 100, dueDate: ONTEM });

    const grade = await asOwner(dono, async () => carregarGrade("2026-03"));
    const por = (nome: string) => grade.find((l) => l.clientName === nome)!;

    expect(por("A Em dia").riscoSugerido).toBeNull();
    expect(por("B Uma vencida").riscoSugerido).toBe("Médio");
    expect(por("C Duas vencidas").riscoSugerido).toBe("Alto");
    expect(por("C Duas vencidas").vencidas).toBe(2);
    // A sugestão já vem APLICADA: o gestor corrige se discordar, em vez de
    // preencher do zero.
    expect(por("C Duas vencidas").risco).toBe("Alto");
    expect(por("C Duas vencidas").motivoSugestao).toMatch(/2 cobranças vencidas/);
  });

  it("a linha chega PREENCHIDA com o mês anterior e marcada como herdada", async () => {
    const cliente = await createMrrClient(dono, { name: "Herdada" });
    const rel = await createRelationship(dono, cliente.id);

    await asOwner(dono, async () =>
      confirmarLinha(
        "2026-04",
        { relationshipId: rel.id, estabilidade: "Estável", ads: "Ativo", upsell: "Mapeado" },
        "gestor@b2c.local"
      )
    );

    const maio = await asOwner(dono, async () => carregarGrade("2026-05"));
    const linha = maio.find((l) => l.relationshipId === rel.id)!;
    expect(linha.estabilidade).toBe("Estável");
    expect(linha.ads).toBe("Ativo");
    expect(linha.upsell).toBe("Mapeado");
    // Herdada, e ainda NÃO confirmada em maio: a distinção é o que diz ao
    // gestor o que falta olhar.
    expect(linha.herdada).toBe(true);
    expect(linha.confirmada).toBe(false);
  });

  it("confirmar sem mudança grava as pendentes e não mexe nas já confirmadas", async () => {
    const a = await createMrrClient(dono, { name: "Lote A" });
    const b = await createMrrClient(dono, { name: "Lote B" });
    const relA = await createRelationship(dono, a.id);
    await createRelationship(dono, b.id);

    await asOwner(dono, async () =>
      confirmarLinha("2026-06", { relationshipId: relA.id, estabilidade: "Crítico" }, "eu@b2c.local")
    );

    const antes = await asOwner(dono, async () => carregarGrade("2026-06"));
    const pendentesAntes = antes.filter((l) => !l.confirmada).length;
    expect(pendentesAntes).toBeGreaterThan(0);

    const gravadas = await asOwner(dono, async () =>
      confirmarSemMudanca("2026-06", antes, "eu@b2c.local")
    );
    expect(gravadas).toBe(pendentesAntes);

    const depois = await asOwner(dono, async () => carregarGrade("2026-06"));
    expect(depois.every((l) => l.confirmada)).toBe(true);
    // A que já estava confirmada manteve o valor — o lote não sobrescreve.
    expect(depois.find((l) => l.relationshipId === relA.id)!.estabilidade).toBe("Crítico");
  });

  it("a avaliação copia os gestores vigentes — é fotografia, não fonte de vigência", async () => {
    const cliente = await createMrrClient(dono, { name: "Fotografia" });
    const rel = await createRelationship(dono, cliente.id);
    const emp = await asOwner(dono, async () =>
      prisma.employee.create({ data: { name: "Carla Gestora" }, select: { id: true } })
    );
    await asOwner(dono, async () =>
      prisma.clientManagerAssignment.create({
        data: { relationshipId: rel.id, managerId: emp.id, role: "MANAGER_1", validFrom: new Date(2026, 0, 1) },
      })
    );

    const av = await asOwner(dono, async () =>
      confirmarLinha("2026-07", { relationshipId: rel.id, risco: "Baixo" }, "eu@b2c.local")
    );
    expect(av.gestores).toEqual(["Carla Gestora"]);
  });

  it("só entram relações ativas ou em implantação", async () => {
    const perdido = await createMrrClient(dono, { name: "Churned" });
    const rel = await createRelationship(dono, perdido.id);
    await asOwner(dono, async () =>
      prisma.clientAgencyRelationship.update({
        where: { id: rel.id },
        data: { lifecycleStatus: "CHURNED" },
      })
    );
    const grade = await asOwner(dono, async () => carregarGrade("2026-08"));
    expect(grade.some((l) => l.relationshipId === rel.id)).toBe(false);
  });
});
