import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createMrrClient, createOwner, destroyOwner, prisma, type TestOwner,
} from "./support/db";
import {
  apenasDigitos, documentoValido, distancia, nomeComparavel, semelhanca,
  telefoneComparavel,
} from "@/lib/commercial/dedupe";
import { analisarConversao, converterLead, criarLead } from "@/lib/services/leads";

/**
 * F4.1 — lead, conversão e deduplicação (01 §4.6).
 *
 * A regra em três níveis, e a diferença entre eles é o módulo inteiro:
 * DOCUMENTO é identidade (liga sozinho), NOME e TELEFONE são pista (viram
 * sugestão), CHURNADO reativa na mesma ficha. Fundir dois clientes de verdade
 * por causa de um nome parecido é o dano mais caro e mais difícil de desfazer
 * da carteira — por isso nada é automático fora do documento.
 */

describe("F4.1 — a comparação, sem banco", () => {
  it("documento vira só dígitos, e só CPF/CNPJ contam", () => {
    expect(apenasDigitos("12.345.678/0001-99")).toBe("12345678000199");
    expect(documentoValido("12345678000199")).toBe(true); // CNPJ
    expect(documentoValido("12345678901")).toBe(true); // CPF
    // Digitação incompleta NÃO é chave: casaria empresas sem relação.
    expect(documentoValido("123")).toBe(false);
    expect(documentoValido(null)).toBe(false);
  });

  it("nome comparável tira acento, pontuação e sufixo de razão social", () => {
    expect(nomeComparavel("Padaria do Bairro LTDA")).toBe("padaria do bairro");
    expect(nomeComparavel("PADARIA DO BAIRRO ME")).toBe("padaria do bairro");
    expect(nomeComparavel("Açaí & Cia.")).toBe("acai");
  });

  it("telefone comparável são os OITO últimos dígitos", () => {
    // Mesmo número escrito de quatro formas.
    const formas = ["+55 (71) 99876-5432", "71998765432", "998765432", "9876-5432"];
    const oitos = formas.map(telefoneComparavel);
    expect(new Set(oitos).size).toBe(1);
    expect(oitos[0]).toBe("98765432");
    expect(telefoneComparavel("123")).toBeNull();
  });

  it("mesmo telefone é a pista mais forte", () => {
    const s = semelhanca(
      { nome: "Empresa A", telefone: "71 99876-5432" },
      { nome: "Nome Totalmente Outro", telefone: "(71) 9 9876 5432" }
    );
    expect(s?.motivo).toBe("mesmo telefone");
    expect(s!.score).toBeGreaterThan(90);
  });

  it("pega o sufixo de razão social e NÃO pega empresas de nome vizinho", () => {
    expect(semelhanca({ nome: "Padaria do Bairro" }, { nome: "Padaria do Bairro LTDA" })).not.toBeNull();
    // Duas empresas diferentes, de donos da mesma família. Fundir estas seria
    // exatamente o erro que a spec manda evitar.
    expect(semelhanca({ nome: "Auto Center Silva" }, { nome: "Auto Center Silva Filho" })).toBeNull();
    expect(semelhanca({ nome: "Padaria do Bairro" }, { nome: "Oficina Central" })).toBeNull();
  });

  it("distância de edição é simétrica e zero para iguais", () => {
    expect(distancia("abc", "abc")).toBe(0);
    expect(distancia("abc", "abd")).toBe(1);
    expect(distancia("kitten", "sitting")).toBe(distancia("sitting", "kitten"));
  });
});

describe("F4.1 — conversão", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.lead.deleteMany({});
      await prisma.client.deleteMany({});
    });
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("documento incompleto NÃO vira chave de deduplicação", async () => {
    await asOwner(dono, async () => {
      const r = await criarLead({ name: "Fulano", document: "123" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const l = await prisma.lead.findUniqueOrThrow({ where: { id: r.lead.id } });
        expect(l.document).toBe("123");
        expect(l.documentDigits).toBeNull();
      }
    });
  });

  it("lead sem par vira cliente NOVO, como PROSPECT", async () => {
    await asOwner(dono, async () => {
      const r = await criarLead({
        name: "João", company: "Padaria Nova", document: "11.222.333/0001-44",
        phone: "71 98888-1111", niche: "alimentação",
      });
      if (!r.ok) throw new Error(r.error);

      const analise = (await analisarConversao(r.lead.id))!;
      expect(analise.mesmoDocumento).toBeNull();
      expect(analise.desfechoPrevisto).toBe("NOVO");

      const c = await converterLead(r.lead.id);
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.desfecho).toBe("NOVO");

      const cliente = await prisma.client.findUniqueOrThrow({ where: { id: c.clientId } });
      expect(cliente.name).toBe("Padaria Nova");
      expect(cliente.status).toBe("PROSPECT");
      expect(cliente.segment).toBe("alimentação");
    });
  });

  it("MESMO DOCUMENTO liga sozinho, mesmo escrito de outro jeito", async () => {
    await asOwner(dono, async () => {
      const existente = await prisma.client.create({
        data: { name: "Padaria do Bairro", document: "11.222.333/0001-44", status: "ACTIVE" },
        select: { id: true },
      });
      const r = await criarLead({ name: "Contato novo", company: "PADARIA BAIRRO", document: "11222333000144" });
      if (!r.ok) throw new Error(r.error);

      const analise = (await analisarConversao(r.lead.id))!;
      expect(analise.mesmoDocumento?.id).toBe(existente.id);
      expect(analise.desfechoPrevisto).toBe("EXISTENTE");
      // Com documento igual, a resposta já é definitiva: nada de sugestão ao
      // lado criando dúvida onde não há.
      expect(analise.sugestoes).toHaveLength(0);

      const c = await converterLead(r.lead.id);
      expect(c.ok && c.clientId).toBe(existente.id);
      expect(await prisma.client.count({})).toBe(1);
    });
  });

  it("CHURNADO reativa na MESMA ficha, sem duplicar", async () => {
    await asOwner(dono, async () => {
      const antigo = await prisma.client.create({
        data: {
          name: "Cliente que saiu", document: "99.888.777/0001-66",
          status: "CHURNED", churnedAt: new Date(2026, 0, 1),
        },
        select: { id: true },
      });
      const r = await criarLead({ name: "Voltou", company: "Cliente que saiu", document: "99888777000166" });
      if (!r.ok) throw new Error(r.error);

      const analise = (await analisarConversao(r.lead.id))!;
      expect(analise.desfechoPrevisto).toBe("REATIVADO");

      const c = await converterLead(r.lead.id);
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.desfecho).toBe("REATIVADO");
      expect(c.clientId).toBe(antigo.id);

      const depois = await prisma.client.findUniqueOrThrow({ where: { id: antigo.id } });
      expect(depois.status).toBe("ACTIVE");
      expect(depois.churnedAt).toBeNull();
      expect(await prisma.client.count({})).toBe(1);
    });
  });

  it("nome parecido vira SUGESTÃO, e nada é ligado sem alguém escolher", async () => {
    await asOwner(dono, async () => {
      const parecido = await createMrrClient(dono, { name: "Padaria do Bairro" });
      const r = await criarLead({ name: "Contato", company: "Padaria do Bairro LTDA" });
      if (!r.ok) throw new Error(r.error);

      const analise = (await analisarConversao(r.lead.id))!;
      expect(analise.mesmoDocumento).toBeNull();
      expect(analise.desfechoPrevisto).toBe("NOVO");
      expect(analise.sugestoes.map((s) => s.clientId)).toContain(parecido.id);

      // Sem escolher, cria NOVO — a sugestão não decide nada sozinha.
      const semEscolher = await converterLead(r.lead.id);
      expect(semEscolher.ok && semEscolher.desfecho).toBe("NOVO");
      expect(await prisma.client.count({})).toBe(2);
    });
  });

  it("aceitar a sugestão liga ao cliente escolhido", async () => {
    await asOwner(dono, async () => {
      const escolhido = await createMrrClient(dono, { name: "Padaria do Bairro" });
      const r = await criarLead({ name: "Contato", company: "Padaria do Bairro LTDA" });
      if (!r.ok) throw new Error(r.error);

      const c = await converterLead(r.lead.id, { clientIdEscolhido: escolhido.id });
      expect(c.ok && c.clientId).toBe(escolhido.id);
      expect(await prisma.client.count({})).toBe(1);
    });
  });

  it("o DOCUMENTO manda sobre a escolha manual", async () => {
    await asOwner(dono, async () => {
      const doDocumento = await prisma.client.create({
        data: { name: "Dono do CNPJ", document: "11.222.333/0001-44", status: "ACTIVE" },
        select: { id: true },
      });
      const outro = await createMrrClient(dono, { name: "Outro cliente" });
      const r = await criarLead({ name: "Contato", company: "X", document: "11222333000144" });
      if (!r.ok) throw new Error(r.error);

      // Escolher o cliente errado não cria dois cadastros com o mesmo CNPJ.
      const c = await converterLead(r.lead.id, { clientIdEscolhido: outro.id });
      expect(c.ok && c.clientId).toBe(doDocumento.id);
    });
  });

  it("converter duas vezes é recusado", async () => {
    await asOwner(dono, async () => {
      const r = await criarLead({ name: "Fulano", company: "Empresa" });
      if (!r.ok) throw new Error(r.error);
      expect((await converterLead(r.lead.id)).ok).toBe(true);
      const segunda = await converterLead(r.lead.id);
      expect(segunda.ok).toBe(false);
    });
  });

  it("o BANCO recusa meia conversão e perda sem motivo", async () => {
    await asOwner(dono, async () => {
      const r = await criarLead({ name: "Fulano" });
      if (!r.ok) throw new Error(r.error);
      await expect(
        prisma.lead.update({ where: { id: r.lead.id }, data: { status: "CONVERTED" } })
      ).rejects.toThrow();
      await expect(
        prisma.lead.update({ where: { id: r.lead.id }, data: { status: "LOST" } })
      ).rejects.toThrow();
    });
  });
});
