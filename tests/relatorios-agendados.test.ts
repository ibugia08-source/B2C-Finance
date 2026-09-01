import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, destroyOwner, prisma, type TestOwner,
} from "./support/db";
import {
  agendarRelatorio, executarAgendamentos, janelaDe,
} from "@/lib/services/scheduled-reports";
import { runWithoutScope } from "@/lib/auth/owner-scope";

/**
 * F5.7 — relatórios agendados.
 *
 * A regra que vale o módulo é a mesma da régua (F3.9): a janela é
 * RECUPERÁVEL e NUNCA dobra. "Semanal" não é "roda segunda" — é "uma vez por
 * semana-calendário", rode o cron no dia que rodar. E o envio dobrado morre
 * em DUAS travas: o lastRunAt do agendamento e a dedupe do Outbox.
 */

// Quarta-feira, de propósito: o agendamento semanal não pode depender de
// o cron rodar na segunda.
const QUARTA = new Date(2027, 3, 14, 9, 0);

describe("F5.7 — relatórios agendados", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await runWithoutScope(async () => {
      await prisma.scheduledReport.deleteMany({});
      await prisma.outboxEvent.deleteMany({ where: { eventType: "SCHEDULED_REPORT" } });
    });
    await destroyOwner(dono);
  });

  it("a janela semanal é a semana-calendário anterior; a mensal, o mês anterior", () => {
    const semana = janelaDe("SEMANAL", QUARTA);
    // Semana de QUARTA 14/04/2027 começa segunda 12/04; a coberta é 05–11/04.
    expect(semana.abertaDesde.getDate()).toBe(12);
    expect(semana.start.getDate()).toBe(5);
    expect(semana.end.getDate()).toBe(12);

    const mes = janelaDe("MENSAL", QUARTA);
    expect(mes.rotulo).toBe("2027-03");
    expect(mes.start.getMonth()).toBe(2);
  });

  it("valida relatório e e-mails; agendamento igual ATUALIZA em vez de dobrar", async () => {
    await asOwner(dono, async () => {
      const inexistente = await agendarRelatorio({
        reportKey: "nao-existe", frequency: "SEMANAL", recipients: ["a@b.co"],
      });
      expect(inexistente.ok).toBe(false);

      const emailRuim = await agendarRelatorio({
        reportKey: "rentabilidade-cliente", frequency: "SEMANAL", recipients: ["nao é email"],
      });
      expect(emailRuim.ok).toBe(false);

      const um = await agendarRelatorio({
        reportKey: "rentabilidade-cliente", frequency: "SEMANAL", recipients: ["a@b.co"],
      });
      expect(um.ok).toBe(true);
      const dois = await agendarRelatorio({
        reportKey: "rentabilidade-cliente", frequency: "SEMANAL",
        recipients: ["a@b.co", "c@d.co"],
      });
      expect(dois.ok).toBe(true);

      const linhas = await prisma.scheduledReport.findMany({
        where: { reportKey: "rentabilidade-cliente" },
      });
      expect(linhas).toHaveLength(1);
      expect(linhas[0].recipients).toEqual(["a@b.co", "c@d.co"]);
    });
  });

  it("a rodada envia UMA vez por janela — rodar de novo no mesmo período pula", async () => {
    const primeira = await executarAgendamentos(QUARTA);
    expect(primeira.enviados).toBe(1);

    const eventos = await runWithoutScope(async () =>
      prisma.outboxEvent.findMany({ where: { eventType: "SCHEDULED_REPORT" } })
    );
    // Um e-mail por destinatário, no canal email, com o HTML pronto.
    expect(eventos).toHaveLength(2);
    expect(eventos.every((e) => e.channel === "email")).toBe(true);
    const payload = eventos[0].payload as any;
    expect(payload.subject).toMatch(/Margem de contribuição/);
    expect(payload.html).toMatch(/semana de/);

    // MESMA janela: pulado, nada novo na fila.
    const segunda = await executarAgendamentos(new Date(2027, 3, 16, 9, 0));
    expect(segunda.enviados).toBe(0);
    expect(segunda.pulados.some((p) => /coberta/i.test(p.motivo))).toBe(true);

    // SEMANA SEGUINTE: envia de novo — a janela virou.
    const terceira = await executarAgendamentos(new Date(2027, 3, 21, 9, 0));
    expect(terceira.enviados).toBe(1);
    const depois = await runWithoutScope(async () =>
      prisma.outboxEvent.count({ where: { eventType: "SCHEDULED_REPORT" } })
    );
    expect(depois).toBe(4);
  });
});
