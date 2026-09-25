import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  assinar, assinaturaConfere, receberEvento, TIPOS_CONHECIDOS,
} from "@/lib/integrations/avancecrm";

/**
 * F4.8 — integração AvanceCRM (03 §4.2, §4.3; cenário S20).
 *
 * O cenário S20 é o teste central: "webhook duplicado — unique key aceita um
 * único fato". Todo provedor reenvia quando não recebe 200 a tempo, e isso é
 * o comportamento CORRETO dele. Sem a unique de entrada, uma resposta lenta
 * nossa vira um segundo fato — e o cliente aparece com dois pagamentos que
 * ele fez uma vez.
 *
 * 24/09/2026: o módulo de Leads/Funil saiu da plataforma. A entrada continua
 * no ar (assinatura + idempotência + caixa), mas evento de lead é GUARDADO
 * como ignorado e não cria nada.
 */
const SEGREDO = "segredo-de-teste-com-mais-de-16-caracteres";

describe("F4.8 — assinatura, sem banco", () => {
  it("assina o corpo CRU, e a assinatura confere", () => {
    const corpo = '{"id":"1","type":"lead.created"}';
    expect(assinaturaConfere(corpo, assinar(corpo, SEGREDO), SEGREDO)).toBe(true);
    expect(assinaturaConfere(corpo, `sha256=${assinar(corpo, SEGREDO)}`, SEGREDO)).toBe(true);
  });

  it("um byte diferente no corpo derruba a assinatura", () => {
    const a = assinar('{"id":"1"}', SEGREDO);
    expect(assinaturaConfere('{"id":"2"}', a, SEGREDO)).toBe(false);
  });

  it("segredo errado não passa", () => {
    const corpo = '{"id":"1"}';
    expect(assinaturaConfere(corpo, assinar(corpo, "outro-segredo-qualquer-16"), SEGREDO)).toBe(false);
  });

  it("assinatura malformada não estoura — devolve falso", () => {
    expect(assinaturaConfere("{}", "não é hexadecimal", SEGREDO)).toBe(false);
    expect(assinaturaConfere("{}", "", SEGREDO)).toBe(false);
  });
});

describe("F4.8 — entrada de webhook", () => {
  let dono: TestOwner;
  let segredoAntes: string | undefined;

  beforeAll(async () => {
    dono = await createOwner();
    segredoAntes = process.env.AVANCECRM_WEBHOOK_SECRET;
    process.env.AVANCECRM_WEBHOOK_SECRET = SEGREDO;
  });

  beforeEach(async () => {
    await runWithoutScope(async () => {
      await prisma.webhookInbox.deleteMany({});
    });
  });

  /** Leads com origem no webhook — não podem mais nascer. */
  const leadsDoWebhook = () =>
    runWithoutScope(async () => prisma.lead.count({ where: { source: "avancecrm" } }));

  afterAll(async () => {
    await runWithoutScope(async () => {
      await prisma.webhookInbox.deleteMany({});
    });
    if (segredoAntes === undefined) delete process.env.AVANCECRM_WEBHOOK_SECRET;
    else process.env.AVANCECRM_WEBHOOK_SECRET = segredoAntes;
    await destroyOwner(dono);
  });

  const envelope = (id: string, type = "lead.created", data: any = { name: "Fulano da Silva" }) =>
    JSON.stringify({ id, type, data });

  const caixa = () => runWithoutScope(async () => prisma.webhookInbox.count({}));

  it("sem assinatura, 401 — e nada entra na caixa", async () => {
    const corpo = envelope("e1");
    const r = await receberEvento(corpo, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
    expect(await caixa()).toBe(0);
  });

  it("evento de lead é GUARDADO como ignorado e não cria lead (módulo removido)", async () => {
    await asOwner(dono, async () => {
      const antes = await leadsDoWebhook();
      const corpo = envelope("e-lead", "lead.created", { name: "Fulano", company: "Padaria X" });
      const r = await receberEvento(corpo, assinar(corpo, SEGREDO));
      expect(r.ok && r.situacao).toBe("IGNORADO");
      const linha = await runWithoutScope(async () =>
        prisma.webhookInbox.findFirstOrThrow({ where: { eventId: "e-lead" } })
      );
      expect(linha.status).toBe("IGNORED");
      expect(linha.note).toMatch(/Leads foi removido/);
      expect(await leadsDoWebhook()).toBe(antes);
    });
  });

  it("S20: o MESMO evento reenviado entra UMA vez e responde 200", async () => {
    await asOwner(dono, async () => {
      const corpo = envelope("evento-repetido");
      const assinatura = assinar(corpo, SEGREDO);

      const primeira = await receberEvento(corpo, assinatura);
      expect(primeira.ok && primeira.situacao).toBe("IGNORADO");

      const segunda = await receberEvento(corpo, assinatura);
      expect(segunda.ok).toBe(true);
      if (segunda.ok) expect(segunda.situacao).toBe("REPETIDO");

      expect(await caixa()).toBe(1);
    });
  });

  it("dez reenvios SIMULTÂNEOS ainda viram um registro só", async () => {
    await asOwner(dono, async () => {
      const corpo = envelope("evento-concorrente");
      const assinatura = assinar(corpo, SEGREDO);
      await Promise.all(
        Array.from({ length: 10 }, () => receberEvento(corpo, assinatura).catch(() => null))
      );
      expect(await caixa()).toBe(1);
    });
  });

  it("tipo desconhecido é GUARDADO como ignorado, não falha", async () => {
    await asOwner(dono, async () => {
      const corpo = envelope("e-desconhecido", "deal.exploded", {});
      const r = await receberEvento(corpo, assinar(corpo, SEGREDO));
      expect(r.ok && r.situacao).toBe("IGNORADO");

      const linha = await runWithoutScope(async () =>
        prisma.webhookInbox.findFirstOrThrow({ where: { eventId: "e-desconhecido" } })
      );
      expect(linha.status).toBe("IGNORED");
      expect(linha.note).toMatch(/não é tratado/i);
      expect(linha.payload).toBeTruthy();
    });
  });

  it("evento sem id ou sem type é recusado com 400", async () => {
    const corpo = JSON.stringify({ type: "lead.created" });
    const r = await receberEvento(corpo, assinar(corpo, SEGREDO));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("corpo que não é JSON é recusado com 400", async () => {
    const corpo = "isto não é json";
    const r = await receberEvento(corpo, assinar(corpo, SEGREDO));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("evento que ficou sem desfecho é tentado de novo — repetido não é sinônimo de resolvido", async () => {
    await asOwner(dono, async () => {
      const corpo = envelope("e-que-falhou", "deal.qualquer", {});
      const assinatura = assinar(corpo, SEGREDO);
      const ws = await runWithoutScope(async () =>
        prisma.workspace.findFirstOrThrow({ select: { id: true } })
      );
      await runWithoutScope(async () =>
        prisma.webhookInbox.create({
          data: {
            workspaceId: ws.id, source: "avancecrm", eventId: "e-que-falhou",
            eventType: "deal.qualquer", payload: {}, status: "RECEIVED",
          },
        })
      );

      const r = await receberEvento(corpo, assinatura);
      // NÃO é "repetido": não houve desfecho, então processa (e ignora).
      expect(r.ok && r.situacao).toBe("IGNORADO");

      const depois = await receberEvento(corpo, assinatura);
      expect(depois.ok && depois.situacao).toBe("REPETIDO");
    });
  });

  it("nenhum tipo de entrada é tratado depois da remoção do funil", () => {
    expect(TIPOS_CONHECIDOS).toEqual([]);
  });
});
