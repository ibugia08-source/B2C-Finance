import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createMrrClient, createOwner, createRelationship, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import {
  carregarQuadro, concluirOnboarding, iniciarOnboarding, marcarTarefa,
} from "@/lib/services/onboarding";
import { ONBOARDING_TEMPLATE, TAREFAS_OBRIGATORIAS } from "@/lib/onboarding-meta";

/**
 * F1.18 — onboarding (01 §4.11, 02 §4.2).
 *
 * O teste que mais importa é o do ENCERRAMENTO: a spec permite sair com
 * obrigatória pendente, mas exige motivo e o resultado é EXCEPTION, não
 * COMPLETE. Se os dois virassem o mesmo estado, a diferença entre "fez
 * tudo" e "seguiu mesmo faltando" sumiria — e é justamente essa
 * diferença que alguém vai querer auditar depois.
 */
describe("F1.18 — onboarding", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  async function relacaoNova(nome: string) {
    const c = await createMrrClient(dono, { name: nome, startedAt: new Date(2026, 0, 10) });
    return createRelationship(dono, c.id, { startedAt: new Date(2026, 0, 10) });
  }

  it("aplica o template com os prazos D+7 / D+30 / D+90", async () => {
    const rel = await relacaoNova("Template");
    const r = await asOwner(dono, async () => iniciarOnboarding(rel.id));
    expect(r.criadas).toBe(ONBOARDING_TEMPLATE.length);

    const q = (await asOwner(dono, async () => carregarQuadro(rel.id)))!;
    expect(q.total).toBe(ONBOARDING_TEMPLATE.length);
    expect(q.status).toBe("IN_PROGRESS");
    expect(q.obrigatoriasPendentes).toBe(TAREFAS_OBRIGATORIAS);

    // Prazo contado da ENTRADA da relação (10/01/2026), não de hoje.
    const contrato = q.tarefas.find((t) => t.templateKey === "contrato")!;
    expect(contrato.offsetDays).toBe(7);
    expect(new Date(contrato.dueAt!).toISOString().slice(0, 10)).toBe("2026-01-17");

    const resultado = q.tarefas.find((t) => t.templateKey === "resultado")!;
    expect(resultado.offsetDays).toBe(90);
    expect(new Date(resultado.dueAt!).toISOString().slice(0, 10)).toBe("2026-04-10");
  });

  it("iniciar duas vezes NÃO duplica tarefa", async () => {
    const rel = await relacaoNova("Idempotente");
    await asOwner(dono, async () => iniciarOnboarding(rel.id));
    const segunda = await asOwner(dono, async () => iniciarOnboarding(rel.id));
    expect(segunda.criadas).toBe(0);

    const q = (await asOwner(dono, async () => carregarQuadro(rel.id)))!;
    expect(q.total).toBe(ONBOARDING_TEMPLATE.length);
  });

  it("RECUSA encerrar com obrigatória pendente e sem motivo", async () => {
    const rel = await relacaoNova("Sem motivo");
    await asOwner(dono, async () => iniciarOnboarding(rel.id));

    const r: any = await asOwner(dono, async () => concluirOnboarding(rel.id));
    expect(r.ok).toBe(false);
    expect(r.pendentes).toBe(TAREFAS_OBRIGATORIAS);
    expect(r.error).toMatch(/obrigatória/i);
  });

  it("com motivo, encerra como EXCEPTION — não como COMPLETE", async () => {
    const rel = await relacaoNova("Com exceção");
    await asOwner(dono, async () => iniciarOnboarding(rel.id));

    const r: any = await asOwner(dono, async () =>
      concluirOnboarding(rel.id, { motivoExcecao: "cliente dispensou o kickoff" })
    );
    expect(r.ok).toBe(true);
    // A diferença entre "fez tudo" e "seguiu mesmo faltando" tem de
    // sobreviver — senão não há o que auditar depois.
    expect(r.status).toBe("EXCEPTION");
  });

  it("com todas as obrigatórias feitas, encerra como COMPLETE", async () => {
    const rel = await relacaoNova("Completo");
    await asOwner(dono, async () => iniciarOnboarding(rel.id));
    const q = (await asOwner(dono, async () => carregarQuadro(rel.id)))!;

    for (const t of q.tarefas.filter((x) => x.required)) {
      await asOwner(dono, async () => marcarTarefa(t.id, true, "gestor@b2c.local"));
    }

    const r: any = await asOwner(dono, async () => concluirOnboarding(rel.id));
    expect(r.ok).toBe(true);
    expect(r.status).toBe("COMPLETE");

    const depois = (await asOwner(dono, async () => carregarQuadro(rel.id)))!;
    expect(depois.obrigatoriasPendentes).toBe(0);
    expect(depois.concluidas).toBe(TAREFAS_OBRIGATORIAS);
  });

  it("marca tarefa atrasada quando o prazo já passou", async () => {
    const c = await createMrrClient(dono, { name: "Atrasado", startedAt: new Date(2020, 0, 1) });
    const rel = await createRelationship(dono, c.id, { startedAt: new Date(2020, 0, 1) });
    await asOwner(dono, async () => iniciarOnboarding(rel.id));

    const q = (await asOwner(dono, async () => carregarQuadro(rel.id)))!;
    expect(q.tarefas.every((t) => t.atrasada)).toBe(true);
  });
});
