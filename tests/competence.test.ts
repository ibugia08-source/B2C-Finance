import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  toCompetence, parseCompetence, isCompetence, competenceOf,
  addMonths, diffMonths, compareCompetence, competenceLabel, competenceShort,
  WORKSPACE_TIMEZONE,
} from "@/lib/competence";
import {
  prisma, runWithoutScope, createOwner, destroyOwner,
  createMrrClient, createBilling, type TestOwner,
} from "./support/db";

/**
 * COMPETÊNCIA CANÔNICA YYYY-MM — ref. 01 §3.15.
 * Cobre o módulo puro e o GATILHO do banco, que é quem garante que a coluna
 * `competence` nunca diverge do par mês/ano, venha a escrita de onde vier.
 */

describe("módulo de competência", () => {
  it("formata e lê o par ano/mês", () => {
    expect(toCompetence(2026, 3)).toBe("2026-03");
    expect(toCompetence(2026, 12)).toBe("2026-12");
    expect(parseCompetence("2026-03")).toEqual({ year: 2026, month: 3 });
    expect(parseCompetence("2026-3")).toBeNull();
    expect(parseCompetence("2026-13")).toBeNull();
    expect(parseCompetence("")).toBeNull();
    expect(parseCompetence(null)).toBeNull();
  });

  it("recusa ano e mês fora de faixa", () => {
    expect(() => toCompetence(2026, 0)).toThrow(RangeError);
    expect(() => toCompetence(2026, 13)).toThrow(RangeError);
    expect(() => toCompetence(1899, 1)).toThrow(RangeError);
  });

  it("reconhece o formato", () => {
    expect(isCompetence("2026-01")).toBe(true);
    expect(isCompetence("2026-1")).toBe(false);
    expect(isCompetence(202601)).toBe(false);
  });

  it("soma meses atravessando o ano", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-06", 12)).toBe("2027-06");
    expect(addMonths("2026-06", 0)).toBe("2026-06");
  });

  it("mede distância e ordena", () => {
    expect(diffMonths("2026-01", "2026-04")).toBe(3);
    expect(diffMonths("2026-04", "2026-01")).toBe(-3);
    expect(compareCompetence("2026-01", "2026-02")).toBeLessThan(0);
    expect(compareCompetence("2026-02", "2026-02")).toBe(0);
    expect(["2026-10", "2026-02", "2026-01"].sort(compareCompetence))
      .toEqual(["2026-01", "2026-02", "2026-10"]);
  });

  it("deriva a competência de uma data NO FUSO DO WORKSPACE", () => {
    // 31/01/2026 23h em Salvador (UTC-3) = 01/02 02h em UTC. A competência
    // é a do workspace: janeiro, não fevereiro.
    const virada = new Date("2026-02-01T02:00:00.000Z");
    expect(competenceOf(virada, WORKSPACE_TIMEZONE)).toBe("2026-01");
    expect(competenceOf(virada, "UTC")).toBe("2026-02");
    expect(competenceOf(new Date("2026-03-15T12:00:00.000Z"))).toBe("2026-03");
  });

  it("gera rótulos legíveis", () => {
    expect(competenceLabel("2026-03")).toBe("Março de 2026");
    expect(competenceShort("2026-03")).toBe("03/2026");
    expect(competenceLabel("lixo")).toBe("lixo");
  });
});

describe("gatilho de competência no banco", () => {
  let owner: TestOwner;
  let clientId: string;

  beforeAll(async () => {
    owner = await createOwner();
    clientId = (await createMrrClient(owner)).id;
  });
  afterAll(async () => {
    await destroyOwner(owner);
  });

  const readCompetence = (id: string) =>
    runWithoutScope(async () =>
      prisma.billing.findUniqueOrThrow({
        where: { id },
        select: { competence: true, competenceMonth: true, competenceYear: true },
      })
    );

  it("preenche a competência na criação, sem a aplicação informar", async () => {
    const b = await createBilling(owner, clientId, { month: 3, year: 2026 });
    const row = await readCompetence(b.id);
    expect(row.competence).toBe("2026-03");
  });

  it("acompanha a mudança do par mês/ano", async () => {
    const b = await createBilling(owner, clientId, { month: 4, year: 2026 });
    expect((await readCompetence(b.id)).competence).toBe("2026-04");

    await runWithoutScope(async () =>
      prisma.billing.update({
        where: { id: b.id },
        data: { competenceMonth: 12, competenceYear: 2027 },
      })
    );
    expect((await readCompetence(b.id)).competence).toBe("2027-12");
  });

  it("ignora escrita direta na coluna: a fonte é o par mês/ano", async () => {
    const b = await createBilling(owner, clientId, { month: 5, year: 2026 });
    await runWithoutScope(async () =>
      prisma.$executeRawUnsafe(
        `UPDATE "Billing" SET "competence" = '1999-01' WHERE "id" = $1`,
        b.id
      )
    );
    // O gatilho recalcula a partir de competenceYear/Month e desfaz a mentira.
    expect((await readCompetence(b.id)).competence).toBe("2026-05");
  });

  it("nenhuma cobrança do banco tem competência divergente", async () => {
    const [{ n }] = await runWithoutScope(async () =>
      prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::int AS n FROM "Billing"
          WHERE "competence" IS DISTINCT FROM
                (lpad("competenceYear"::text,4,'0') || '-' || lpad("competenceMonth"::text,2,'0'))`
      )
    );
    expect(Number(n)).toBe(0);
  });
});

describe("instantes gravados em UTC", () => {
  let owner: TestOwner;

  beforeAll(async () => {
    owner = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(owner);
  });

  it("uma data gravada volta como o MESMO instante", async () => {
    const instante = new Date("2026-03-10T14:35:00.000Z");
    const c = await createMrrClient(owner, { startedAt: instante });
    const lido = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { startedAt: true } })
    );
    expect(lido.startedAt?.toISOString()).toBe(instante.toISOString());
  });

  it("as colunas de data são timestamptz (instante explícito)", async () => {
    const cols = await runWithoutScope(async () =>
      prisma.$queryRawUnsafe<{ data_type: string }[]>(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema='public' AND table_name='Billing' AND column_name IN ('dueDate','paidAt','createdAt')`
      )
    );
    expect(cols).toHaveLength(3);
    for (const c of cols) expect(c.data_type).toBe("timestamp with time zone");
  });
});
