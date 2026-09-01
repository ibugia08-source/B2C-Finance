import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  assinar, assinaturaConfere, receberEvento, TIPOS_CONHECIDOS,
} from "@/lib/integrations/avancecrm";
import { criarLead } from "@/lib/services/leads";
import { criarOportunidade } from "@/lib/services/pipeline";
import { fecharVenda } from "@/lib/services/sale-handoff";

/**
 * F4.8 — integração AvanceCRM (03 §4.2, §4.3; cenário S20).
 *
 * O cenário S20 é o teste central: "webhook duplicado — unique key aceita um
 * único fato". Todo provedor reenvia quando não recebe 200 a tempo, e isso é
 * o comportamento CORRETO dele. Sem a unique de entrada, uma resposta lenta
 * nossa vira um segundo fato — e o cliente aparece com dois pagamentos que
 * ele fez uma vez.
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
      // O lead que entra por webhook pertence ao DONO DA CONTA, não ao dono
      // do teste — o webhook não tem usuário logado. Por isso a limpeza (e as
      // contagens abaixo) rodam fora de escopo, filtrando pela origem.
      await prisma.lead.deleteMany({ where: { source: "avancecrm" } });
    });
  });

  /** Leads criados pelo webhook, independentemente de quem é o dono. */
  const leadsDoWebhook = () =>
    runWithoutScope(async () => prisma.lead.count({ where: { source: "avancecrm" } }));

  afterAll(async () => {
    await runWithoutScope(async () => {
      await prisma.webhookInbox.deleteMany({});
      await prisma.lead.deleteMany({ where: { source: "avancecrm" } });
    });
    if (segredoAntes === undefined) delete process.env.AVANCECRM_WEBHOOK_SECRET;
    else process.env.AVANCECRM_WEBHOOK_SECRET = segredoAntes;
    await destroyOwner(dono);
  });

  const envelope = (id: string, type = "lead.created", data: any = { name: "Fulano da Silva" }) =>
    JSON.stringify({ id, type, data });

  it("sem assinatura, 401 — e nada entra na caixa", async () => {
    const corpo = envelope("e1");
    const r = await receberEvento(corpo, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
    expect(await runWithoutScope(async () => prisma.webhookInbox.count({}))).toBe(0);
  });

  it("S20: o MESMO evento reenviado entra UMA vez e responde 200", async () => {
    await asOwner(dono, async () => {
      const corpo = envelope("evento-repetido");
      const assinatura = assinar(corpo, SEGREDO);

      const primeira = await receberEvento(corpo, assinatura);
      expect(primeira.ok && primeira.situacao).toBe("PROCESSADO");

      const segunda = await receberEvento(corpo, assinatura);
      expect(segunda.ok).toBe(true);
      if (segunda.ok) expect(segunda.situacao).toBe("REPETIDO");

      // Um registro na caixa, UM lead. É o cenário inteiro.
      expect(await runWithoutScope(async () => prisma.webhookInbox.count({}))).toBe(1);
      expect(await leadsDoWebhook()).toBe(1);
    });
  });

  it("dez reenvios SIMULTÂNEOS ainda criam um lead só", async () => {
    await asOwner(dono, async () => {
      const corpo = envelope("evento-concorrente");
      const assinatura = assinar(corpo, SEGREDO);
      await Promise.all(
        Array.from({ length: 10 }, () => receberEvento(corpo, assinatura).catch(() => null))
      );
      expect(await leadsDoWebhook()).toBe(1);
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
      // Falhar faria o provedor reenviar para sempre; aceitar em silêncio
      // esconderia que chegou coisa que ninguém trata.
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

  it("o lead criado pelo webhook nasce com a origem marcada", async () => {
    await asOwner(dono, async () => {
      const corpo = envelope("e-origem", "lead.created", {
        name: "Maria", empresa: "Padaria X", telefone: "71 99999-0000",
      });
      await receberEvento(corpo, assinar(corpo, SEGREDO));
      const lead = await runWithoutScope(async () =>
        prisma.lead.findFirstOrThrow({ where: { source: "avancecrm" } })
      );
      expect(lead.source).toBe("avancecrm");
      expect(lead.company).toBe("Padaria X");
    });
  });

  it("evento que FALHOU é tentado de novo no reenvio — repetido não é sinônimo de resolvido", async () => {
    await asOwner(dono, async () => {
      const corpo = envelope("e-que-falhou");
      const assinatura = assinar(corpo, SEGREDO);

      // Simula a primeira tentativa que entrou na caixa e não teve desfecho
      // (foi o que aconteceu de verdade: o webhook não tem usuário logado e a
      // criação do lead falhava na chave estrangeira do dono).
      const ws = await runWithoutScope(async () =>
        prisma.workspace.findFirstOrThrow({ select: { id: true } })
      );
      await runWithoutScope(async () =>
        prisma.webhookInbox.create({
          data: {
            workspaceId: ws.id, source: "avancecrm", eventId: "e-que-falhou",
            eventType: "lead.created", payload: {}, status: "RECEIVED",
          },
        })
      );

      const r = await receberEvento(corpo, assinatura);
      // NÃO é "repetido": não houve desfecho, então processa.
      expect(r.ok && r.situacao).toBe("PROCESSADO");
      expect(await leadsDoWebhook()).toBe(1);

      // Agora sim, o próximo reenvio é repetição de verdade.
      const depois = await receberEvento(corpo, assinatura);
      expect(depois.ok && depois.situacao).toBe("REPETIDO");
      expect(await leadsDoWebhook()).toBe(1);
    });
  });

  it("os tipos tratados estão declarados", () => {
    expect(TIPOS_CONHECIDOS).toContain("lead.created");
  });
});

describe("F4.8 — saída pelo Outbox", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("fechar a venda PUBLICA no outbox, no canal do CRM", async () => {
    await asOwner(dono, async () => {
      const lead = await criarLead({ name: "Contato", company: "Empresa do Outbox" });
      if (!lead.ok) throw new Error(lead.error);
      const op = await criarOportunidade({
        title: "Venda do outbox", leadId: lead.lead.id, amount: 5000, modality: "TCV",
      });
      if (!op.ok) throw new Error(op.error);

      const r = await fecharVenda(op.id, { quando: new Date(2027, 8, 10) });
      expect(r.ok).toBe(true);

      const evento = await runWithoutScope(async () =>
        prisma.outboxEvent.findFirst({
          where: { sourceType: "Opportunity", sourceId: op.id },
        })
      );
      expect(evento).not.toBeNull();
      expect(evento!.channel).toBe("crm");
      expect(evento!.eventType).toBe("SALE_WON");
      // Conteúdo MÍNIMO (03 §4.2): o CRM não precisa do valor do contrato.
      expect(Object.keys(evento!.payload as any)).not.toContain("amount");
      expect(Object.keys(evento!.payload as any)).not.toContain("valor");

      await runWithoutScope(async () =>
        prisma.outboxEvent.deleteMany({ where: { sourceId: op.id } })
      );
    });
  });
});
