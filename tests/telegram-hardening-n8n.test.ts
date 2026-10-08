import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * TELEGRAM · BLOCO 3 — HARDENING dos workflows versionados.
 *  · formatação: &, < >, emoji, acento, R$ e textos longos — escape, ordem,
 *    nada repetido, nada truncado no relatório, nenhuma parte acima de 4096,
 *    nenhum emoji partido;
 *  · anti-flood por Telegram User ID antes da API e da IA;
 *  · API fora do ar: mensagem padronizada, sem IA, execução registrada como erro;
 *  · só chat privado; identidade só por from.id;
 *  · credenciais só como referência placeholder; nenhuma referência $('…') em
 *    parâmetro de nó HTTP (no n8n 1.123 ela não resolve dentro de loop).
 */

const RAIZ = join(process.cwd(), "integrations/n8n/workflows");
const ler = (f: string) => JSON.parse(readFileSync(join(RAIZ, f), "utf8"));
const no = (w: any, nome: string) => w.nodes.find((n: any) => n.name === nome);
const prox = (w: any, n: string, saida = 0) => (w.connections[n]?.main?.[saida] ?? []).map((c: any) => c.node);

const agente = ler("b2c-finance-telegram-agent.json");
const leitura = ler("b2c-finance-telegram-agent-readonly.json");
const manha = ler("telegram-daily-morning-report.json");
const TELEGRAM = ["b2c-finance-telegram-agent.json", "b2c-finance-telegram-agent-readonly.json", "telegram-daily-morning-report.json", "telegram-daily-evening-report.json", "telegram-connection-test.json"];

async function rodar(w: any, nome: string, itens: any[], extra: { env?: any; estatico?: any } = {}) {
  const fn = new Function("$input", "$getWorkflowStaticData", "$env", `return (async () => { ${no(w, nome).parameters.jsCode} })();`);
  return ((await fn({ all: () => itens.map((json) => ({ json })) }, () => extra.estatico ?? {}, extra.env ?? {})) as any[]).map((i) => i.json);
}
const semHtml = (t: string) => t.replace(/<i>Parte \d+\/\d+<\/i>\n/, "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("formatação para o Telegram (HTML)", () => {
  it("escapa &, < > e mantém emoji, acento e R$ — nada vira tag", async () => {
    for (const w of [agente, leitura, manha]) {
      const [m] = await rodar(w, "Formatar para o Telegram", [{ chatId: 1, texto: "*Açaí & Cia <b>* — R$ 1.500,00 😀 ✅ ção\n<script>alert(1)</script>" }]);
      expect(m.text).toBe("<b>Açaí &amp; Cia &lt;b&gt;</b> — R$ 1.500,00 😀 ✅ ção\n&lt;script&gt;alert(1)&lt;/script&gt;");
    }
  });

  it("relatório longo: divide em ordem, sem repetir, sem truncar, cada parte ≤ 4096", async () => {
    const linhas = Array.from({ length: 400 }, (_, i) => `• Linha ${String(i).padStart(3, "0")} — Cliente & Filhos <ltda> — R$ ${i},00 😀`);
    const texto = "*Relatório*\n\n" + linhas.slice(0, 200).join("\n") + "\n\n" + linhas.slice(200).join("\n");
    const partes = await rodar(manha, "Formatar para o Telegram", [{ chatId: 9, texto }]);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.length).toBeLessThanOrEqual(10);
    partes.forEach((p, i) => {
      expect(p.text.length).toBeLessThanOrEqual(4096);
      expect(p.text.startsWith(`<i>Parte ${i + 1}/${partes.length}</i>`)).toBe(true);
    });
    const junto = partes.map((p) => semHtml(p.text)).join("\n");
    const achadas = linhas.map((l) => junto.indexOf(l));
    expect(achadas.every((x) => x >= 0)).toBe(true); // nada truncado
    expect([...achadas].sort((a, b) => a - b)).toEqual(achadas); // ordem preservada
    for (const l of linhas) expect(junto.split(l).length - 1).toBe(1); // nada repetido
    expect(junto).not.toContain("peça um recorte menor");
  });

  it("conteúdo hostil: linha enorme só de & e emojis no ponto de corte não quebram o envio", async () => {
    for (const texto of ["&".repeat(9000), "😀".repeat(5000), "a".repeat(3499) + "😀" + "b".repeat(4000)]) {
      const partes = await rodar(manha, "Formatar para o Telegram", [{ chatId: 1, texto }]);
      for (const p of partes) {
        expect(p.text.length).toBeLessThanOrEqual(4096);
        expect(loneSurrogate.test(p.text)).toBe(false);
      }
    }
  });

  it("agente somente leitura: envia todas as partes sem truncar; texto vazio → mensagem neutra", async () => {
    const enorme = Array.from({ length: 60 }, (_, i) => `Parágrafo ${i} ` + "x ".repeat(400)).join("\n\n");
    const partes = await rodar(leitura, "Formatar para o Telegram", [{ chatId: 1, output: enorme }]);
    expect(partes.length).toBeGreaterThan(4);
    expect(partes.map((p) => p.text).join("\n")).toContain("Parágrafo 59");
    expect(partes.map((p) => p.text).join("\n")).not.toContain("peça um recorte menor");
    const [vazio] = await rodar(leitura, "Formatar para o Telegram", [{ chatId: 1, output: "" }]);
    expect(vazio.text).toBe("Não consegui concluir essa consulta agora. A tentativa foi registrada.");
  });
});

describe("anti-flood por pessoa", () => {
  it("20 por minuto por Telegram User ID; o 21º recebe UM aviso; o resto é descartado; outra pessoa segue", async () => {
    for (const w of [agente, leitura]) {
      expect(prox(w, "Chat privado?", 0)).toEqual(["Limitar mensagens por pessoa"]);
      expect(prox(w, "Dentro do limite?", 0)).toEqual(["Extrair Telegram User ID"]);
      expect(prox(w, "Dentro do limite?", 1)).toEqual(["Formatar para o Telegram"]);
      const estatico = {};
      const itens = Array.from({ length: 25 }, () => ({ fromId: "111", chatId: 111 }));
      const saida = await rodar(w, "Limitar mensagens por pessoa", itens, { estatico });
      expect(saida.filter((s) => !s.limitado)).toHaveLength(20);
      expect(saida.filter((s) => s.limitado)).toHaveLength(1);
      expect(saida.find((s) => s.limitado).texto).toContain("Aguarde um minuto");
      const outro = await rodar(w, "Limitar mensagens por pessoa", [{ fromId: "222", chatId: 222 }], { estatico });
      expect(outro[0].limitado).toBe(false);
      const configurado = await rodar(w, "Limitar mensagens por pessoa", Array.from({ length: 4 }, () => ({ fromId: "333", chatId: 333 })), { estatico: {}, env: { TELEGRAM_MAX_UPDATES_POR_MINUTO: "2" } });
      expect(configurado.filter((s) => !s.limitado)).toHaveLength(2);
    }
  });
});

describe("API B2C fora do ar", () => {
  it("mensagem padronizada, sem IA, e a execução é registrada como erro no n8n", async () => {
    for (const [w, nome] of [[agente, "Roteiro da mensagem"], [leitura, "Roteiro da mensagem"]] as const) {
      const [r] = await rodar(w, nome, [{ authorized: false, motivo: "erro_tecnico", fromId: "1", chatId: 1, tipo: "text", text: "Quanto recebemos hoje?" }]);
      expect(r.rota).toBe("responder");
      expect(r.falhaApi).toBe(true);
      expect(r.texto).toBe("Não consegui acessar os dados do B2C Finance neste momento. Tente novamente em alguns minutos.");
      const [f] = await rodar(w, "Formatar para o Telegram", [{ chatId: 1, texto: r.texto, falhaApi: true }]);
      expect(f.falhaApi).toBe(true);
      expect(prox(w, "Telegram: enviar mensagem")).toEqual(["Falha da API?"]);
      expect(prox(w, "Falha da API?", 0)).toEqual(["Registrar falha da API"]);
      expect(no(w, "Registrar falha da API").type).toBe("n8n-nodes-base.stopAndError");
      expect(no(w, "Registrar falha da API").parameters.errorMessage).not.toMatch(/token|Bearer/i);
    }
    const prompt = no(agente, "AI Agent B2C Finance (Telegram)").parameters.options.systemMessage as string;
    expect(prompt).toContain("Não consegui acessar os dados do B2C Finance neste momento");
    expect(prompt).toContain("Nunca troque o dado atual pela base de conhecimento");
  });
});

describe("chat privado e identidade", () => {
  it("group, supergroup e channel nunca chegam à API; grupo recebe só orientação genérica", async () => {
    for (const w of [agente, leitura]) {
      const cond = no(w, "Chat privado?").parameters.conditions.conditions[0].leftValue;
      expect(cond).toBe("={{ $json.chatType === 'private' && !!$json.fromId }}");
      const fora = async (chatType: string) => rodar(w, "Resposta: só no privado", [{ chatType, fromId: "1", chatId: -100 }]);
      for (const t of ["group", "supergroup"]) {
        const [r] = await fora(t);
        expect(r.texto).toBe("Por segurança, eu só atendo em conversa privada. Fale comigo no privado.");
      }
      expect(await fora("channel")).toEqual([]);
      expect(prox(w, "Resposta: só no privado")).toEqual(["Formatar para o Telegram"]);
    }
  });

  it("identidade = from.id; username, nome e título do chat nunca vão para a API", async () => {
    for (const w of [agente, leitura]) {
      const corpo = no(w, "API: resolver identidade").parameters.jsonBody;
      expect(corpo).toBe("={{ JSON.stringify({ channel: 'TELEGRAM', externalIdentifier: $json.externalIdentifier }) }}");
      const [e] = await rodar(w, "Extrair Telegram User ID", [{ fromId: "123456789", username: "outra_pessoa", firstName: "Admin" }]);
      expect(e.externalIdentifier).toBe("123456789");
      const [semId] = [await rodar(w, "Extrair Telegram User ID", [{ fromId: null, username: "admin" }])];
      expect(semId).toEqual([]);
    }
  });
});

describe("credenciais e expressões", () => {
  it("toda credencial é referência placeholder (CONFIGURAR_*) com nome fixo; nenhum valor", () => {
    const nomes = new Set<string>();
    for (const f of TELEGRAM) {
      for (const n of ler(f).nodes) {
        for (const [tipo, ref] of Object.entries<any>(n.credentials ?? {})) {
          expect(ref.id, `${f}/${n.name}`).toMatch(/^CONFIGURAR_[A-Z0-9_]+$/);
          expect(Object.keys(ref).sort()).toEqual(["id", "name"]);
          nomes.add(`${tipo}:${ref.name}`);
        }
      }
    }
    expect([...nomes].sort()).toEqual([
      "httpHeaderAuth:B2C Finance API", "httpHeaderAuth:B2C Finance API — escrita Telegram", "openAiApi:OpenAI", "qdrantApi:Qdrant (conhecimento)", "telegramApi:Telegram Bot",
    ]);
  });

  it("nenhum parâmetro de nó HTTP usa $('…') (não resolve dentro de loop no n8n 1.123)", () => {
    for (const f of TELEGRAM) {
      for (const n of ler(f).nodes.filter((x: any) => /httpRequest/.test(x.type))) {
        expect(JSON.stringify(n.parameters), `${f}/${n.name}`).not.toContain("$('");
      }
    }
  });

  it("todos os workflows do repositório chegam desativados", () => {
    for (const f of readdirSync(RAIZ).filter((x) => x.endsWith(".json"))) expect(ler(f).active, f).toBe(false);
  });
});
