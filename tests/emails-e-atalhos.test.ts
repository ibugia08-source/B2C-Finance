import { describe, expect, it } from "vitest";
import { esc, renderEmail } from "@/lib/email/template";
import {
  EMAILS_DE_EXEMPLO, emailDeCobranca, emailDeConvite, emailDeFechamento,
} from "@/lib/email/messages";

/**
 * F3.12 — e-mails transacionais no tema (02 §7.8).
 *
 * O que estes testes protegem são as restrições do MEIO, não do gosto: e-mail
 * não tem CSS externo, não tem flex e costuma chegar com as imagens
 * bloqueadas. Uma regressão em qualquer um dos três chega quebrada na única
 * leitura que importa — a primeira.
 */
describe("F3.12 — o tema do e-mail", () => {
  const html = renderEmail({
    titulo: "Título de teste",
    preheader: "Linha da caixa de entrada",
    paragrafos: ["Primeiro parágrafo.", "Segundo parágrafo."],
    botao: { rotulo: "Abrir", href: "https://exemplo.b2c/x" },
    destaque: [{ rotulo: "Valor", valor: "R$ 100,00" }],
    rodape: ["Rodapé."],
  });

  it("cabeçalho navy, corpo claro (02 §7.8)", () => {
    expect(html).toContain("#0d1b2e");
    expect(html).toContain("background:#ffffff");
  });

  it("TUDO inline: nada de <style> nem class — clientes de e-mail removem os dois", () => {
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/class=/i);
  });

  it("sem flex e sem grid: o Outlook renderiza com o motor do Word", () => {
    expect(html).not.toMatch(/display:\s*flex/i);
    expect(html).not.toMatch(/display:\s*grid/i);
  });

  it("SEM IMAGEM decorativa — a maioria dos clientes bloqueia por padrão", () => {
    expect(html).not.toMatch(/<img/i);
  });

  it("UM botão de acento, nunca dois", () => {
    const botoes = html.match(/border-radius:8px;background:#1e70d3/g) ?? [];
    expect(botoes).toHaveLength(1);
  });

  it("tem preheader escondido — é a segunda linha da caixa de entrada", () => {
    expect(html).toContain("Linha da caixa de entrada");
    expect(html).toMatch(/display:none;max-height:0/);
  });

  it("escapa o que vem do cliente: nome com & não quebra o HTML", () => {
    expect(esc('Bar & Cia <b>')).toBe("Bar &amp; Cia &lt;b&gt;");
    const comAspas = renderEmail({
      titulo: 'Cliente "Aspas" & Cia',
      preheader: "x",
      paragrafos: ["<script>alert(1)</script>"],
    });
    expect(comAspas).not.toContain("<script>");
    expect(comAspas).toContain("&lt;script&gt;");
  });
});

describe("F3.12 — o conteúdo dos e-mails", () => {
  it("cobrança MUDA DE TOM com o atraso, como a régua", () => {
    const aVencer = emailDeCobranca({
      cliente: "Padaria do Bairro", descricao: "Tráfego", valor: "R$ 1.000,00",
      vencimento: "10/09/2026", diasDeAtraso: 0,
    });
    const vencida = emailDeCobranca({
      cliente: "Padaria do Bairro", descricao: "Tráfego", valor: "R$ 1.000,00",
      vencimento: "10/08/2026", diasDeAtraso: 12,
    });
    expect(aVencer.assunto).toMatch(/vence em/);
    expect(vencida.assunto).toMatch(/em aberto/);
    expect(vencida.html).toMatch(/12 dias/);
  });

  it("a cobrança abre espaço para o cliente que JÁ PAGOU sem ficar acusatória", () => {
    const vencida = emailDeCobranca({
      cliente: "Oficina", descricao: "Tráfego", valor: "R$ 1.000,00",
      vencimento: "10/08/2026", diasDeAtraso: 3,
    });
    expect(vencida.html).toMatch(/já foi paga/i);
  });

  it("NENHUM e-mail vaza conceito interno (01 §5.2)", () => {
    const proibidos = [
      "competência", "competence", "billing", "recognitionMode", "ledger",
      "snapshot", "relationship", "outbox",
    ];
    for (const { nome, email } of EMAILS_DE_EXEMPLO) {
      const texto = email.html.toLowerCase();
      for (const p of proibidos) {
        expect(texto.includes(p.toLowerCase()), `${nome} vazou "${p}"`).toBe(false);
      }
    }
  });

  it("o convite diz o que acontece se a pessoa NÃO esperava o convite", () => {
    const c = emailDeConvite({
      nome: "Bianca Souza", papel: "Financeiro", convidadoPor: "Vitor",
      link: "https://exemplo.b2c/x",
    });
    expect(c.html).toMatch(/não esperava/i);
  });

  it("o aviso de fechamento explica que reabrir exige justificativa", () => {
    const f = emailDeFechamento({
      competencia: "Agosto de 2026", resultado: "R$ 12.430,00",
      quemFechou: "Vitor", versao: 1,
    });
    expect(f.html).toMatch(/justificativa/i);
  });

  it("todo e-prova do catálogo tem assunto, preheader e corpo", () => {
    for (const { nome, email } of EMAILS_DE_EXEMPLO) {
      expect(email.assunto.length, nome).toBeGreaterThan(5);
      expect(email.preheader.length, nome).toBeGreaterThan(5);
      expect(email.html.length, nome).toBeGreaterThan(500);
    }
  });
});
