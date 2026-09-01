import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  gerarNotificacoesDoDia, marcarLida, notificacoesDe, TETO_DIARIO,
} from "@/lib/services/notifications";

/**
 * F1.19 — central de notificações.
 *
 * As duas regras anti-fadiga de 02 §4.7 são o que se prova aqui:
 *  1. AGRUPAMENTO POR ORIGEM: gerar duas vezes no dia ATUALIZA a linha (a
 *     contagem muda), nunca cria outra — a unique do banco é a garantia.
 *  2. TETO DIÁRIO: a 16ª do dia nasce como resumo (digest) — e crítica fura.
 */

const HOJE = new Date(2027, 7, 26); // dia 26: liga também "avaliação pendente"

describe("F1.19 — central de notificações", () => {
  let dono: TestOwner;
  let donoAnteriorDoWorkspace: string | null = null;

  beforeAll(async () => {
    dono = await createOwner();
    // O gerador lê os dados do DONO DO WORKSPACE (mesmo caminho dos webhooks).
    await runWithoutScope(async () => {
      const ws = await prisma.workspace.findFirstOrThrow({ select: { id: true, ownerId: true } });
      donoAnteriorDoWorkspace = ws.ownerId;
      await prisma.workspace.update({ where: { id: ws.id }, data: { ownerId: dono.id } });
    });
  });
  afterAll(async () => {
    await runWithoutScope(async () => {
      await prisma.notification.deleteMany({});
      const ws = await prisma.workspace.findFirstOrThrow({ select: { id: true } });
      await prisma.workspace.update({
        where: { id: ws.id },
        data: { ownerId: donoAnteriorDoWorkspace },
      });
    });
    await destroyOwner(dono);
  });

  it("gerar duas vezes no mesmo dia AGRUPA — uma linha por assunto, contagem viva", async () => {
    await asOwner(dono, async () => {
      const c = await createMrrClient(dono, { name: "Devedor notificado" });
      await createBilling(dono, c.id, {
        month: 6, year: 2027, amount: 700, dueDate: new Date(2027, 5, 10),
      });
    });

    const uma = await gerarNotificacoesDoDia(HOJE);
    expect(uma.geradas).toBeGreaterThan(0);

    // Mais uma vencida entra no dia…
    await asOwner(dono, async () => {
      const c2 = await createMrrClient(dono, { name: "Segundo devedor" });
      await createBilling(dono, c2.id, {
        month: 7, year: 2027, amount: 300, dueDate: new Date(2027, 6, 10),
      });
    });
    await gerarNotificacoesDoDia(HOJE);

    const linhas = await runWithoutScope(async () =>
      prisma.notification.findMany({
        where: { recipientId: dono.id, event: "cobranca_vencida" },
      })
    );
    // …e continua UMA linha, com a contagem atualizada.
    expect(linhas).toHaveLength(1);
    expect(linhas[0].count).toBe(2);
    expect(linhas[0].detail).toMatch(/2 em aberto/);
  });

  it("marcar lida respeita o destinatário; a lista separa resumo de principal", async () => {
    const { lista, naoLidas } = await notificacoesDe(dono.id);
    expect(lista.length).toBeGreaterThan(0);
    expect(naoLidas).toBeGreaterThan(0);

    const alvo = lista[0];
    // Outro destinatário não marca a notificação alheia.
    await marcarLida("usuario-que-nao-existe", alvo.id);
    let depois = await notificacoesDe(dono.id);
    expect(depois.lista.find((l) => l.id === alvo.id)?.lida).toBe(false);

    await marcarLida(dono.id, alvo.id);
    depois = await notificacoesDe(dono.id);
    expect(depois.lista.find((l) => l.id === alvo.id)?.lida).toBe(true);
  });

  it("teto diário: a 16ª vira resumo — e crítica fura o teto", async () => {
    // Enche o dia com 15 notificações "vivas" sintéticas.
    const dia = "2027-08-26";
    await runWithoutScope(async () => {
      await prisma.notification.deleteMany({ where: { recipientId: dono.id } });
      for (let i = 0; i < TETO_DIARIO; i++) {
        await prisma.notification.create({
          data: {
            event: `sintetica_${i}`, recipientId: dono.id, title: `Aviso ${i}`,
            day: dia, severity: "media", ownerId: dono.id,
          },
        });
      }
    });
    await gerarNotificacoesDoDia(HOJE);

    const novas = await runWithoutScope(async () =>
      prisma.notification.findMany({
        where: { recipientId: dono.id, day: dia, event: { not: { startsWith: "sintetica" } } },
      })
    );
    expect(novas.length).toBeGreaterThan(0);
    for (const n of novas) {
      if (n.severity === "critica") expect(n.digest).toBe(false);
      else expect(n.digest).toBe(true);
    }
  });
});
