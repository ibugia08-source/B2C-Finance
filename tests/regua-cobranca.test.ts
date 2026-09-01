import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import {
  avaliarRegua, diasEntre, ehDiaUtil, etapaDoDia, etapaPendente, ETAPAS,
  type EstadoDaCobranca,
} from "@/lib/collection/regua";
import {
  ajustarPreferenciaDeCobranca, filaDeCobranca, registrarEnvioDaRegua,
  registrarPromessa,
} from "@/lib/services/collection-tasks";

/**
 * F3.9 — régua de cobrança em modo tarefa.
 *
 * Este é o módulo que FALA COM O CLIENTE. Um erro aqui não aparece num
 * relatório: aparece no WhatsApp de quem está pagando em dia, e não tem como
 * desfazer. Por isso a régua é uma função pura, e por isso metade destes
 * testes não toca no banco — dá para exercitar as cinco etapas contra os
 * cinco silêncios em milissegundos.
 */

// Quinta-feira, para os testes de calendário não caírem em fim de semana.
const QUINTA = new Date(2027, 3, 15);

function estado(p: Partial<EstadoDaCobranca> = {}): EstadoDaCobranca {
  return {
    dueDate: QUINTA,
    quitada: false,
    promessaAte: null,
    optOut: false,
    silencioAte: null,
    bloqueio: null,
    etapasEnviadas: [],
    ...p,
  };
}

describe("F3.9 — a régua, sem banco", () => {
  it("as cinco etapas de 02 §4.3, nesta ordem", () => {
    expect(ETAPAS.map((e) => e.id)).toEqual(["D-3", "D0", "D+3", "D+7", "D+15"]);
    expect(ETAPAS.map((e) => e.offset)).toEqual([-3, 0, 3, 7, 15]);
  });

  it("o tom SOBE degrau a degrau — nunca cobra quem ia pagar em dia", () => {
    expect(ETAPAS[0].tom).toBe("amigavel");
    expect(ETAPAS[4].tom).toBe("ultima_tentativa");
  });

  it("cada etapa cai no dia certo", () => {
    const venc = new Date(2027, 3, 15);
    expect(etapaDoDia(new Date(2027, 3, 12), venc)).toBe("D-3");
    expect(etapaDoDia(new Date(2027, 3, 15), venc)).toBe("D0");
    expect(etapaDoDia(new Date(2027, 3, 18), venc)).toBe("D+3");
    expect(etapaDoDia(new Date(2027, 3, 22), venc)).toBe("D+7");
    expect(etapaDoDia(new Date(2027, 3, 30), venc)).toBe("D+15");
    expect(etapaDoDia(new Date(2027, 3, 13), venc)).toBeNull();
  });

  it("é RECUPERÁVEL: a fila da segunda pega o degrau que passou no fim de semana", () => {
    const venc = new Date(2027, 3, 15);
    // 9 dias de atraso, nada enviado: o degrau é D+7, não "nenhum".
    expect(etapaPendente(new Date(2027, 3, 24), estado({ dueDate: venc }))).toBe("D+7");
    // E a régua NÃO VOLTA: com D+7 enviado, D+3 não é candidato — mandar o
    // lembrete gentil depois da cobrança urgente desmontaria a escalada.
    expect(
      etapaPendente(new Date(2027, 3, 24), estado({ dueDate: venc, etapasEnviadas: ["D+7"] }))
    ).toBeNull();
  });

  it("nunca dispara três mensagens no mesmo dia", () => {
    // Segunda-feira, 11 dias de atraso: o degrau é D+7 e só ele.
    const r = avaliarRegua(new Date(2027, 3, 26), estado({ dueDate: new Date(2027, 3, 15) }));
    expect(r.gerar).toBe(true);
    if (r.gerar) expect(r.etapa.id).toBe("D+7");
  });

  it("promessa vigente CALA a régua — é o silêncio que mais custa quebrar", () => {
    const r = avaliarRegua(QUINTA, estado({ promessaAte: new Date(2027, 3, 20) }));
    expect(r.gerar).toBe(false);
    if (!r.gerar) expect(r.motivo).toBe("PROMESSA");
  });

  it("promessa VENCIDA devolve a cobrança para a fila", () => {
    const r = avaliarRegua(QUINTA, estado({ promessaAte: new Date(2027, 3, 10) }));
    expect(r.gerar).toBe(true);
  });

  it("opt-out, silêncio e bloqueio calam, cada um com seu motivo", () => {
    for (const [campo, motivo] of [
      ["optOut", "OPT_OUT"],
      ["silencioAte", "SILENCIO"],
      ["bloqueio", "BLOQUEIO"],
    ] as const) {
      const valor =
        campo === "optOut" ? true : campo === "silencioAte" ? new Date(2027, 4, 1) : "Em negociação";
      const r = avaliarRegua(QUINTA, estado({ [campo]: valor } as any));
      expect(r.gerar).toBe(false);
      if (!r.gerar) expect(r.motivo).toBe(motivo);
    }
  });

  it("cobrança paga sai da régua antes de qualquer outra checagem", () => {
    const r = avaliarRegua(QUINTA, estado({ quitada: true, bloqueio: "qualquer" }));
    expect(r.gerar).toBe(false);
    if (!r.gerar) expect(r.motivo).toBe("PAGA");
  });

  it("fim de semana não gera tarefa — e a tarefa reaparece na segunda", () => {
    const sabado = new Date(2027, 3, 17);
    expect(ehDiaUtil(sabado)).toBe(false);
    const r = avaliarRegua(sabado, estado());
    expect(r.gerar).toBe(false);
    if (!r.gerar) expect(r.motivo).toBe("FIM_DE_SEMANA");

    const segunda = new Date(2027, 3, 19);
    expect(ehDiaUtil(segunda)).toBe(true);
    expect(avaliarRegua(segunda, estado()).gerar).toBe(true);
  });

  it("a mesma etapa não sai duas vezes", () => {
    const r = avaliarRegua(QUINTA, estado({ etapasEnviadas: ["D-3", "D0"] }));
    // D0 já saiu; o próximo degrau pendente ainda não chegou.
    expect(r.gerar).toBe(false);
    if (!r.gerar) expect(r.motivo).toBe("SEM_ETAPA_HOJE");
  });

  it("diasEntre ignora a hora do dia", () => {
    const a = new Date(2027, 3, 15, 23, 59);
    const b = new Date(2027, 3, 16, 0, 1);
    expect(diasEntre(a, b)).toBe(1);
  });
});

describe("F3.9 — a fila no banco", () => {
  let dono: TestOwner;
  let cliente: { id: string; name: string };

  beforeAll(async () => {
    dono = await createOwner();
    cliente = await createMrrClient(dono, { name: "Cliente da régua" });
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.collectionHistory.deleteMany({});
      await prisma.billing.deleteMany({});
      await prisma.client.update({
        where: { id: cliente.id },
        data: {
          collectionOptOut: false,
          collectionSilenceUntil: null,
          collectionBlockReason: null,
        },
      });
    });
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  async function cobrancaVencidaHa(dias: number, valor = 1200) {
    const hoje = new Date(2027, 3, 15);
    const venc = new Date(hoje.getTime() - dias * 86_400_000);
    return asOwner(dono, async () =>
      prisma.billing.create({
        data: {
          clientId: cliente.id,
          description: "Mensalidade de teste",
          competenceMonth: venc.getMonth() + 1,
          competenceYear: venc.getFullYear(),
          amount: valor,
          dueDate: venc,
          status: "PENDING",
        },
        select: { id: true },
      })
    );
  }

  it("gera a tarefa com a mensagem pronta no tom do degrau", async () => {
    await asOwner(dono, async () => {
      await cobrancaVencidaHa(7);
      const fila = await filaDeCobranca(new Date(2027, 3, 15));
      expect(fila.tarefas).toHaveLength(1);
      const t = fila.tarefas[0];
      expect(t.etapa).toBe("D+7");
      expect(t.tom).toBe("urgente");
      expect(t.diasDeAtraso).toBe(7);
      expect(t.valorEmAberto).toBe(1200);
      expect(t.mensagem).toContain("Cliente");
      expect(t.mensagem.length).toBeGreaterThan(40);
    });
  });

  it("registrar o envio tira a cobrança da fila E a mesma etapa não repete", async () => {
    await asOwner(dono, async () => {
      const b = await cobrancaVencidaHa(7);
      const um = await registrarEnvioDaRegua(b.id, "D+7");
      expect(um.ok).toBe(true);

      // A trava é do BANCO (unique billingId+reguaStep): o segundo clique
      // recebe resposta limpa em vez de mandar a mesma mensagem de novo.
      const dois = await registrarEnvioDaRegua(b.id, "D+7");
      expect(dois.ok).toBe(false);
      if (!dois.ok) expect(dois.error).toMatch(/já foi enviada/i);

      const fila = await filaDeCobranca(new Date(2027, 3, 15));
      expect(fila.tarefas).toHaveLength(0);
    });
  });

  it("contato MANUAL pode se repetir — a trava é só da régua", async () => {
    await asOwner(dono, async () => {
      const b = await cobrancaVencidaHa(7);
      for (let i = 0; i < 3; i++) {
        await prisma.collectionHistory.create({
          data: { billingId: b.id, clientId: cliente.id, status: "CONTACTED" },
        });
      }
      expect(await prisma.collectionHistory.count({ where: { billingId: b.id } })).toBe(3);
    });
  });

  it("promessa tira da fila e APARECE em 'fora da fila', com a data", async () => {
    await asOwner(dono, async () => {
      const b = await cobrancaVencidaHa(7);
      const prometido = new Date(2027, 3, 20);
      expect((await registrarPromessa(b.id, prometido)).ok).toBe(true);

      const fila = await filaDeCobranca(new Date(2027, 3, 15));
      expect(fila.tarefas).toHaveLength(0);
      expect(fila.suprimidas).toHaveLength(1);
      expect(fila.suprimidas[0].motivo).toBe("PROMESSA");
      expect(fila.suprimidas[0].ate?.getDate()).toBe(20);
    });
  });

  it("bloqueio EXIGE motivo, e o cliente bloqueado continua visível na fila", async () => {
    await asOwner(dono, async () => {
      await cobrancaVencidaHa(7);

      const curto = await ajustarPreferenciaDeCobranca(cliente.id, { bloqueio: "x" });
      expect(curto.ok).toBe(false);

      const ok = await ajustarPreferenciaDeCobranca(cliente.id, {
        bloqueio: "Cliente em negociação de reparcelamento",
      });
      expect(ok.ok).toBe(true);

      const fila = await filaDeCobranca(new Date(2027, 3, 15));
      expect(fila.tarefas).toHaveLength(0);
      // NÃO some: dívida que envelhece em silêncio é o que a fila evita.
      expect(fila.suprimidas[0].motivo).toBe("BLOQUEIO");
      expect(fila.suprimidas[0].valorEmAberto).toBe(1200);
    });
  });

  it("o banco recusa bloqueio sem motivo, mesmo por fora do serviço", async () => {
    await asOwner(dono, async () => {
      await expect(
        prisma.client.update({
          where: { id: cliente.id },
          data: { collectionBlockReason: "abc" },
        })
      ).rejects.toThrow();
    });
  });

  it("cobrança quitada não entra na fila", async () => {
    await asOwner(dono, async () => {
      const b = await cobrancaVencidaHa(7);
      await prisma.billing.update({
        where: { id: b.id },
        data: { paidTotal: 1200, status: "PAID" },
      });
      const fila = await filaDeCobranca(new Date(2027, 3, 15));
      expect(fila.tarefas).toHaveLength(0);
      expect(fila.suprimidas).toHaveLength(0);
    });
  });

  it("a fila ordena pelo que some primeiro: mais atrasado, depois maior", async () => {
    await asOwner(dono, async () => {
      const outro = await createMrrClient(dono, { name: "Segundo cliente" });
      await cobrancaVencidaHa(3, 500);
      await asOwner(dono, async () =>
        prisma.billing.create({
          data: {
            clientId: outro.id, description: "Mensalidade grande",
            competenceMonth: 3, competenceYear: 2027, amount: 9000,
            dueDate: new Date(2027, 3, 15 - 15), status: "PENDING",
          },
        })
      );
      const fila = await filaDeCobranca(new Date(2027, 3, 15));
      expect(fila.tarefas).toHaveLength(2);
      expect(fila.tarefas[0].diasDeAtraso).toBe(15);
      expect(fila.totalEmAberto).toBe(9500);
    });
  });
});
