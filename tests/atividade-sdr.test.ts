import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asOwner, createOwner, destroyOwner, prisma, type TestOwner } from "./support/db";
import {
  CAMPOS_DE_ATIVIDADE, diasUteis, painelDoSdr, registrarAtividade,
} from "@/lib/services/sdr-activity";

/**
 * F4.3 — atividade diária do SDR (cenário S2: "registrada em 30 segundos,
 * com meta visível").
 *
 * Trinta segundos decide o formato: um TOQUE por campo, sem formulário e sem
 * salvar. O que estes testes protegem é o que faria o toque parar de ser
 * confiável — contar duas vezes o primeiro, perder um toque simultâneo, ou
 * cobrar meta de sábado.
 */
describe("F4.3 — atividade do SDR", () => {
  let dono: TestOwner;
  const HOJE = new Date(2027, 3, 15); // quinta

  beforeAll(async () => {
    dono = await createOwner();
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.atividadeDiaria.deleteMany({});
      await prisma.commercialGoal.deleteMany({});
    });
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("o PRIMEIRO toque conta UMA vez", async () => {
    await asOwner(dono, async () => {
      const r = await registrarAtividade("Bianca", "ligacoes", 1, { hoje: HOJE });
      expect(r.ok && r.valor).toBe(1);
      const linhas = await prisma.atividadeDiaria.findMany({});
      expect(linhas).toHaveLength(1);
      expect(linhas[0].ligacoes).toBe(1);
    });
  });

  it("toques repetidos somam na MESMA linha do dia", async () => {
    await asOwner(dono, async () => {
      for (let i = 0; i < 5; i++) await registrarAtividade("Bianca", "ligacoes", 1, { hoje: HOJE });
      const linhas = await prisma.atividadeDiaria.findMany({});
      expect(linhas).toHaveLength(1);
      expect(linhas[0].ligacoes).toBe(5);
    });
  });

  it("toques SIMULTÂNEOS não se perdem (o incremento é do banco)", async () => {
    await asOwner(dono, async () => {
      await registrarAtividade("Bianca", "abordagens", 1, { hoje: HOJE });
      await Promise.all(
        Array.from({ length: 8 }, () =>
          registrarAtividade("Bianca", "abordagens", 1, { hoje: HOJE })
        )
      );
      const linha = await prisma.atividadeDiaria.findFirstOrThrow({});
      expect(linha.abordagens).toBe(9);
    });
  });

  it("o menos corrige o toque errado e não passa de zero", async () => {
    await asOwner(dono, async () => {
      await registrarAtividade("Bianca", "propostas", 1, { hoje: HOJE });
      await registrarAtividade("Bianca", "propostas", -1, { hoje: HOJE });
      const r = await registrarAtividade("Bianca", "propostas", -1, { hoje: HOJE });
      expect(r.ok && r.valor).toBe(0);
      const linha = await prisma.atividadeDiaria.findFirstOrThrow({});
      expect(linha.propostas).toBe(0);
    });
  });

  it("dias de SDRs diferentes não se misturam", async () => {
    await asOwner(dono, async () => {
      await registrarAtividade("Bianca", "ligacoes", 3, { hoje: HOJE });
      await registrarAtividade("Raiane", "ligacoes", 7, { hoje: HOJE });
      const b = await painelDoSdr("Bianca", { hoje: HOJE });
      const r = await painelDoSdr("Raiane", { hoje: HOJE });
      expect(b.hoje.ligacoes).toBe(3);
      expect(r.hoje.ligacoes).toBe(7);
    });
  });

  it("a meta do DIA é a do mês dividida pelos dias ÚTEIS", async () => {
    await asOwner(dono, async () => {
      await prisma.commercialGoal.create({
        data: { competence: "2027-04", scopeType: "SDR", scopeId: "Bianca", metric: "ligacoes", target: 220 },
      });
      const { total } = diasUteis(HOJE);
      const p = await painelDoSdr("Bianca", { hoje: HOJE });
      const ligacoes = p.progresso.find((x) => x.campo === "ligacoes")!;
      expect(ligacoes.metaDoMes).toBe(220);
      expect(ligacoes.metaDoDia).toBe(Math.ceil(220 / total));
      // Abril de 2027 tem 22 dias úteis — cobrar meta de sábado seria o jeito
      // mais rápido de o SDR parar de olhar para o número.
      expect(total).toBe(22);
    });
  });

  it("sem meta, o número aparece SEM alvo em vez de inventar um", async () => {
    await asOwner(dono, async () => {
      const p = await painelDoSdr("Bianca", { hoje: HOJE });
      expect(p.progresso.every((x) => x.metaDoMes === null)).toBe(true);
      expect(p.progresso.every((x) => x.metaDoDia === null)).toBe(true);
    });
  });

  it("comparecimento = realizadas ÷ (realizadas + no-show)", async () => {
    await asOwner(dono, async () => {
      await registrarAtividade("Bianca", "reunioesRealizadas", 8, { hoje: HOJE });
      await registrarAtividade("Bianca", "noShows", 2, { hoje: HOJE });
      const p = await painelDoSdr("Bianca", { hoje: HOJE });
      expect(p.comparecimento).toBe(80);
    });
  });

  it("sem reunião marcada, comparecimento é NULO — não é 0%", async () => {
    await asOwner(dono, async () => {
      const p = await painelDoSdr("Bianca", { hoje: HOJE });
      expect(p.comparecimento).toBeNull();
    });
  });

  it("no-show NÃO tem meta: ninguém tem alvo de cliente que não apareceu", () => {
    const noShow = CAMPOS_DE_ATIVIDADE.find((c) => c.id === "noShows")!;
    expect(noShow.metricaDaMeta).toBeNull();
  });

  it("o banco recusa contagem negativa e meta zerada", async () => {
    await asOwner(dono, async () => {
      const linha = await prisma.atividadeDiaria.create({
        data: { date: HOJE, sdr: "Bianca", agencyId: "" },
        select: { id: true },
      });
      await expect(
        prisma.atividadeDiaria.update({ where: { id: linha.id }, data: { ligacoes: -1 } })
      ).rejects.toThrow();
      await expect(
        prisma.commercialGoal.create({
          data: { competence: "2027-04", scopeType: "SDR", scopeId: "X", metric: "ligacoes", target: 0 },
        })
      ).rejects.toThrow();
    });
  });
});
