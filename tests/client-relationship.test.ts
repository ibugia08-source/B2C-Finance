import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createMrrClient, createOwner, createRelationship, defaultAgency,
  destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";

/**
 * F1.1 — CLIENT MESTRE + ClientAgencyRelationship (ref. 01 §4.3 e §3.9).
 *
 * O que estes testes travam:
 *  · a relação é única por (cliente, agência) — duas seriam duas carteiras
 *    do mesmo cliente na mesma agência, que é o bug e não o caso de uso;
 *  · o MESMO cliente pode ter relação em DUAS agências, que é a razão de
 *    o modelo existir;
 *  · as quatro dimensões de status são INDEPENDENTES (§3.9): dá para estar
 *    ACTIVE no ciclo e DELINQUENT no financeiro ao mesmo tempo;
 *  · escopo por dono nas entidades novas — sem isso um usuário veria a
 *    carteira do outro;
 *  · avaliação mensal é única por competência (idempotência de 03 §4.3);
 *  · apagar a relação leva junto avaliações e onboarding, mas NÃO apaga a
 *    perda: ClientLoss aponta com SetNull porque o histórico de churn tem
 *    de sobreviver ao fim da relação.
 */
describe("F1.1 — relação cliente ↔ agência", () => {
  let dono: TestOwner;
  let outro: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
    outro = await createOwner();
  });

  afterAll(async () => {
    await destroyOwner(dono);
    await destroyOwner(outro);
  });

  it("cria uma relação por cliente e recusa a segunda na mesma agência", async () => {
    const cliente = await createMrrClient(dono, { name: "Relação única" });
    const rel = await createRelationship(dono, cliente.id);
    expect(rel.clientId).toBe(cliente.id);

    const agencia = await defaultAgency();
    await expect(
      asOwner(dono, async () =>
        prisma.clientAgencyRelationship.create({
          data: { clientId: cliente.id, agencyId: agencia.id },
        })
      )
    ).rejects.toThrow();
  });

  it("permite o MESMO cliente em duas agências — a razão de o modelo existir", async () => {
    const cliente = await createMrrClient(dono, { name: "Cliente em duas agências" });
    const primeira = await defaultAgency();
    await createRelationship(dono, cliente.id, { agencyId: primeira.id });

    // Segunda agência, na mesma entidade legal.
    const segunda = await runWithoutScope(async () => {
      const le = await prisma.legalEntity.findFirstOrThrow({ select: { id: true, workspaceId: true } });
      return prisma.agency.create({
        data: {
          workspaceId: le.workspaceId,
          legalEntityId: le.id,
          name: "Agência de teste F1.1",
          slug: `teste-f11-${Date.now()}`,
        },
        select: { id: true },
      });
    });

    const rel2 = await createRelationship(dono, cliente.id, { agencyId: segunda.id });
    expect(rel2.agencyId).toBe(segunda.id);

    const todas = await asOwner(dono, async () =>
      prisma.clientAgencyRelationship.findMany({ where: { clientId: cliente.id } })
    );
    expect(todas).toHaveLength(2);

    await runWithoutScope(async () => {
      await prisma.clientAgencyRelationship.deleteMany({ where: { agencyId: segunda.id } });
      await prisma.agency.delete({ where: { id: segunda.id } });
    });
  });

  it("mantém as quatro dimensões de status independentes (01 §3.9)", async () => {
    const cliente = await createMrrClient(dono, { name: "Ativo e inadimplente" });
    const rel = await createRelationship(dono, cliente.id);

    // O caso que o v1 não conseguia representar: cliente ATIVO que deve.
    const atualizada = await asOwner(dono, async () =>
      prisma.clientAgencyRelationship.update({
        where: { id: rel.id },
        data: { financialStatus: "DELINQUENT", renewalStatus: "NEGOTIATING" },
      })
    );
    expect(atualizada.lifecycleStatus).toBe("ACTIVE");
    expect(atualizada.financialStatus).toBe("DELINQUENT");
    expect(atualizada.renewalStatus).toBe("NEGOTIATING");
    expect(atualizada.onboardingStatus).toBe("NOT_STARTED");
  });

  it("não vaza relação entre donos", async () => {
    const cliente = await createMrrClient(dono, { name: "Privado" });
    await createRelationship(dono, cliente.id);

    const vistoPeloOutro = await asOwner(outro, async () =>
      prisma.clientAgencyRelationship.findMany({ where: { clientId: cliente.id } })
    );
    expect(vistoPeloOutro).toHaveLength(0);
  });

  it("aceita uma avaliação por competência e recusa a segunda", async () => {
    const cliente = await createMrrClient(dono, { name: "Avaliado" });
    const rel = await createRelationship(dono, cliente.id);

    await asOwner(dono, async () =>
      prisma.avaliacaoMensal.create({
        data: { relationshipId: rel.id, competence: "2026-08", estabilidade: "estavel", risco: "baixo" },
      })
    );

    await expect(
      asOwner(dono, async () =>
        prisma.avaliacaoMensal.create({
          data: { relationshipId: rel.id, competence: "2026-08", risco: "alto" },
        })
      )
    ).rejects.toThrow();

    // Outra competência passa.
    const setembro = await asOwner(dono, async () =>
      prisma.avaliacaoMensal.create({
        data: { relationshipId: rel.id, competence: "2026-09", risco: "medio" },
      })
    );
    expect(setembro.competence).toBe("2026-09");
  });

  it("apagar a relação leva avaliações e onboarding, mas preserva a perda", async () => {
    const cliente = await createMrrClient(dono, { name: "Cascata" });
    const rel = await createRelationship(dono, cliente.id);

    await asOwner(dono, async () => {
      await prisma.avaliacaoMensal.create({
        data: { relationshipId: rel.id, competence: "2026-07" },
      });
      await prisma.onboardingTask.create({
        data: { relationshipId: rel.id, title: "Acesso ao gerenciador", offsetDays: 7 },
      });
      await prisma.clientLoss.create({
        data: { clientId: cliente.id, relationshipId: rel.id, reason: "teste" },
      });
    });

    await asOwner(dono, async () =>
      prisma.clientAgencyRelationship.delete({ where: { id: rel.id } })
    );

    const [avaliacoes, tarefas, perdas] = await asOwner(dono, async () => [
      await prisma.avaliacaoMensal.count({ where: { relationshipId: rel.id } }),
      await prisma.onboardingTask.count({ where: { relationshipId: rel.id } }),
      await prisma.clientLoss.findMany({ where: { clientId: cliente.id } }),
    ]);

    expect(avaliacoes).toBe(0);
    expect(tarefas).toBe(0);
    // A perda sobrevive, sem apontar para a relação que não existe mais.
    expect(perdas).toHaveLength(1);
    expect(perdas[0].relationshipId).toBeNull();
  });
});
