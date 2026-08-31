import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { canonicalJson, checksumByArea, checksumOf, money } from "@/lib/snapshots/serialize";
import { gerarSnapshot, montarAreas, snapshotDe } from "@/lib/snapshots/engine";
import { fecharPeriodo, periodoDe, reabrirPeriodo } from "@/lib/services/closing-period";
import { conferirIntegridade } from "@/lib/snapshots/integrity";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * F2.3 — fotografia do período (01 §5.4).
 *
 * O checksum só vale alguma coisa se a MESMA realidade produzir sempre os
 * mesmos bytes. É isso que a primeira metade destes testes protege: sem
 * determinismo, o job de integridade acusaria divergência todo dia sem nada
 * ter mudado, e em uma semana ninguém olharia mais o alerta.
 */

describe("F2.3 — serialização determinística", () => {
  it("a ordem das chaves não muda o resultado", () => {
    const a = { b: 2, a: 1, c: { z: 9, y: 8 } };
    const b = { c: { y: 8, z: 9 }, a: 1, b: 2 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(checksumOf(a)).toBe(checksumOf(b));
  });

  it("ruído de ponto flutuante não muda o checksum", () => {
    // 0.1 + 0.2 dá 0.30000000000000004 em JavaScript.
    expect(checksumOf({ v: 0.1 + 0.2 })).toBe(checksumOf({ v: 0.3 }));
  });

  it("data vira ISO em UTC — o fuso do servidor não entra", () => {
    const d = new Date("2026-03-15T12:00:00.000Z");
    expect(canonicalJson({ d })).toContain("2026-03-15T12:00:00.000Z");
  });

  it("dinheiro guarda os centavos como texto", () => {
    expect(money(1234.5)).toBe("1234.50");
    expect(money(0.1 + 0.2)).toBe("0.30");
  });

  it("mudar UMA área muda só o checksum dela — e o total", () => {
    const base = { carteira: [{ id: "a" }], folha: [{ id: "b" }] };
    const mexida = { carteira: [{ id: "z" }], folha: [{ id: "b" }] };
    const a = checksumByArea(base);
    const b = checksumByArea(mexida);
    expect(a.porArea.folha).toBe(b.porArea.folha);
    expect(a.porArea.carteira).not.toBe(b.porArea.carteira);
    expect(a.total).not.toBe(b.total);
  });
});

describe("F2.3 — a fotografia", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    const ws = await currentWorkspaceId();
    await runWithoutScope(async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" DISABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.snapshot.deleteMany({ where: { workspaceId: ws } });
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" ENABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.closingPeriod.deleteMany({ where: { workspaceId: ws } });
    });
    await destroyOwner(dono);
  });
  beforeEach(async () => {
    const ws = await currentWorkspaceId();
    await runWithoutScope(async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" DISABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.snapshot.deleteMany({ where: { workspaceId: ws } });
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" ENABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.closingPeriod.deleteMany({ where: { workspaceId: ws } });
    });
  });

  it("guarda todas as áreas de §5.4", async () => {
    const areas = await asOwner(dono, async () => montarAreas("2026-02"));
    for (const nome of [
      "carteira", "termos_vigentes", "receber", "pagar", "caixa_reservas",
      "folha", "avaliacao", "indicadores", "funil", "dre_razao_resumido",
    ]) {
      expect(Object.keys(areas), nome).toContain(nome);
    }
  });

  it("área sem fonte DECLARA que não existe — nunca vem vazia", async () => {
    // Área vazia é indistinguível de área que zerou, e a confusão só aparece
    // meses depois, quando é tarde.
    const areas: any = await asOwner(dono, async () => montarAreas("2026-02"));
    expect(areas.funil.indisponivel).toBe(true);
    expect(areas.funil.motivo).toMatch(/Fase 4/);
    expect(areas.dre_razao_resumido.indisponivel).toBe(true);
  });

  it("fechar o mês gera a fotografia junto (§5.4: ClosingEngine gera no CLOSED)", async () => {
    const cliente = await createMrrClient(dono, { name: "Foto de fevereiro" });
    await createBilling(dono, cliente.id, { month: 2, year: 2026, amount: 700 });

    await asOwner(dono, async () => fecharPeriodo("2026-02", "Israel"));
    const foto = await asOwner(dono, async () => snapshotDe("2026-02"));

    expect(foto).toBeTruthy();
    expect(foto!.kind).toBe("NATIVE");
    expect(foto!.checksum).toHaveLength(64);
    expect(foto!.metricRegistryVersion).toBeGreaterThan(0);
    expect(foto!.sourceCutoffAt).toBeTruthy();
    expect(foto!.closedBy).toBe("Israel");
  });

  it("fechar duas vezes na mesma versão não duplica a fotografia", async () => {
    await asOwner(dono, async () => fecharPeriodo("2026-02", "Israel"));
    await asOwner(dono, async () => fecharPeriodo("2026-02", "Israel"));
    const ws = await currentWorkspaceId();
    const qtd = await runWithoutScope(async () =>
      prisma.snapshot.count({ where: { workspaceId: ws, competence: "2026-02" } })
    );
    expect(qtd).toBe(1);
  });

  it("a fotografia é IMUTÁVEL — o banco recusa reescrever e apagar", async () => {
    await asOwner(dono, async () => fecharPeriodo("2026-02", "Israel"));
    const foto = await asOwner(dono, async () => snapshotDe("2026-02"));

    await expect(
      runWithoutScope(async () =>
        prisma.snapshot.update({
          where: { id: foto!.id },
          data: { checksum: "outro" },
        })
      )
    ).rejects.toThrow();

    await expect(
      runWithoutScope(async () => prisma.snapshot.delete({ where: { id: foto!.id } }))
    ).rejects.toThrow();
  });

  it("reabrir marca a fotografia POSTERIOR para reconferência", async () => {
    await asOwner(dono, async () => fecharPeriodo("2026-02", "Israel"));
    await asOwner(dono, async () => fecharPeriodo("2026-03", "Israel"));

    const r = await asOwner(dono, async () =>
      reabrirPeriodo("2026-02", "corrigir nota lançada no mês errado", "Israel")
    );
    expect(r.ok).toBe(true);

    const posterior = await asOwner(dono, async () => snapshotDe("2026-03"));
    // A fotografia de março é a que os painéis de março vão ler — marcar só o
    // período deixaria ela sendo mostrada como confiável.
    expect(posterior!.needsRevalidation).toBe(true);

    // E marcar não é alterar conteúdo: o gatilho de imutabilidade deixou passar.
    expect(posterior!.checksum).toHaveLength(64);
  });

  it("fechar de novo depois de reabrir cria a versão 2, sem apagar a 1", async () => {
    await asOwner(dono, async () => fecharPeriodo("2026-02", "Israel"));
    await asOwner(dono, async () =>
      reabrirPeriodo("2026-02", "corrigir lançamento duplicado", "Israel")
    );
    const p = await asOwner(dono, async () => periodoDe("2026-02"));
    expect(p.versao).toBe(2);

    await asOwner(dono, async () => fecharPeriodo("2026-02", "Israel"));

    const ws = await currentWorkspaceId();
    const todas = await runWithoutScope(async () =>
      prisma.snapshot.findMany({
        where: { workspaceId: ws, competence: "2026-02" },
        orderBy: { version: "asc" },
        select: { version: true },
      })
    );
    // "Agosto v1 preservado, agosto v2 novo" (§5.5) — a v1 continua lá.
    expect(todas.map((t) => t.version)).toEqual([1, 2]);
  });

  it("fotografia avulsa é nomeada e não se passa por fechamento", async () => {
    const r = await asOwner(dono, async () =>
      gerarSnapshot("2026-02", { kind: "STANDALONE", name: "Antes da renegociação" })
    );
    const ws = await currentWorkspaceId();
    const foto = await runWithoutScope(async () =>
      prisma.snapshot.findUniqueOrThrow({ where: { id: r.id } })
    );
    expect(foto.kind).toBe("STANDALONE");
    expect(foto.name).toBe("Antes da renegociação");
    // A vigente do mês continua sendo a nativa (que aqui não existe).
    void ws;
    expect(await asOwner(dono, async () => snapshotDe("2026-02"))).toBeNull();
  });
});

describe("F2.8 — job de integridade", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    const ws = await currentWorkspaceId();
    await runWithoutScope(async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" DISABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.snapshot.deleteMany({ where: { workspaceId: ws } });
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" ENABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.closingPeriod.deleteMany({ where: { workspaceId: ws } });
    });
    await destroyOwner(dono);
  });

  it("mês fechado e intocado passa", async () => {
    const cliente = await createMrrClient(dono, { name: "Integridade" });
    await createBilling(dono, cliente.id, { month: 5, year: 2026, amount: 400 });
    await asOwner(dono, async () => fecharPeriodo("2026-05", "Israel"));

    const r = await asOwner(dono, async () =>
      conferirIntegridade({ competencias: ["2026-05"] })
    );
    expect(r.fotografiasConferidas).toBe(1);
    expect(r.divergencias).toHaveLength(0);
  });

  it("cobrança criada DEPOIS do fechamento NÃO é divergência (01 §5.6)", async () => {
    // Pagamento e cobrança que entram depois são a operação funcionando.
    // Acusar isso reprovaria o job toda vez que a cobrança fizesse o trabalho.
    const cliente = await createMrrClient(dono, { name: "Depois do fechamento" });
    await createBilling(dono, cliente.id, { month: 5, year: 2026, amount: 999 });

    const r = await asOwner(dono, async () =>
      conferirIntegridade({ competencias: ["2026-05"] })
    );
    expect(r.divergencias).toHaveLength(0);
  });

  it("linha ALTERADA depois do fechamento é apanhada", async () => {
    // Este é o caso que o job existe para pegar: mexer no passado sem
    // reabrir a competência.
    const antes = await asOwner(dono, async () =>
      prisma.billing.findFirst({
        where: { competence: "2026-05", amount: 400 },
        select: { id: true },
      })
    );
    await asOwner(dono, async () =>
      prisma.billing.update({ where: { id: antes!.id }, data: { amount: 4000 } })
    );

    const r = await asOwner(dono, async () =>
      conferirIntegridade({ competencias: ["2026-05"] })
    );
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].mudaramDesdeOFechamento).toContain("receber");
    // Não foi adulteração da linha da fotografia: ela continua íntegra.
    expect(r.divergencias[0].adulteradas).toHaveLength(0);
    expect(r.ok).toBe(false);

    // devolve o valor para não contaminar o teste seguinte
    await asOwner(dono, async () =>
      prisma.billing.update({ where: { id: antes!.id }, data: { amount: 400 } })
    );
  });

  it("recalcular a mesma foto duas vezes dá o mesmo resultado", async () => {
    // Se o recálculo não fosse determinístico, o job acusaria divergência
    // todo dia e seria desligado na primeira semana.
    const a = await asOwner(dono, async () =>
      conferirIntegridade({ competencias: ["2026-05"] })
    );
    const b = await asOwner(dono, async () =>
      conferirIntegridade({ competencias: ["2026-05"] })
    );
    expect(JSON.stringify(a.divergencias)).toBe(JSON.stringify(b.divergencias));
  });
});
