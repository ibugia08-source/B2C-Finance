import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * INADIMPLÊNCIA NO AGENTE (29/09/2026) — workflows versionados.
 *  · os agentes do Telegram (somente leitura e com escrita) têm
 *    consultar_inadimplencia → GET /receivables/delinquency;
 *  · a ferramenta só é liberada a quem tem o scope E a permissão "Ver
 *    inadimplência" devolvida pela API (a rota confere de novo);
 *  · o somente leitura continua sem nenhuma escrita;
 *  · WhatsApp: mesmo conjunto de ferramentas de antes;
 *  · descrições e prompt: DELINQUENT não é toda a inadimplência, vazio vale
 *    só para o recorte, sempre dizer recorte/posição, lista parcial com total.
 */

const W = join(process.cwd(), "integrations/n8n/workflows");
const ler = (f: string) => JSON.parse(readFileSync(join(W, f), "utf8"));
const no = (w: any, n: string) => w.nodes.find((x: any) => x.name === n);
const ferramentas = (w: any) => w.nodes.filter((n: any) => w.connections[n.name]?.ai_tool).map((n: any) => n.name).sort();

const TG_LEITURA = ler("b2c-finance-telegram-agent-readonly.json");
const TG_ESCRITA = ler("b2c-finance-telegram-agent.json");
const AGENTE_TG = { [TG_LEITURA.name]: "AI Agent B2C Finance (Telegram, somente leitura)", [TG_ESCRITA.name]: "AI Agent B2C Finance (Telegram)" };

describe("consultar_inadimplencia nos agentes do Telegram", () => {
  it("existe nos dois, faz GET em /receivables/delinquency com origem telegram, delegação e só competence/page/pageSize", () => {
    for (const w of [TG_LEITURA, TG_ESCRITA]) {
      const t = no(w, "consultar_inadimplencia");
      expect(t.type).toBe("@n8n/n8n-nodes-langchain.toolHttpRequest");
      expect(t.parameters.method).toBe("GET");
      expect(t.parameters.url).toBe("={{ ($json.allowedTools || []).includes('consultar_inadimplencia') ? $env.B2C_FINANCE_API_URL : 'https://ferramenta-nao-liberada-para-este-perfil.invalid' }}/receivables/delinquency");
      expect(t.parameters.parametersQuery.values.map((q: any) => [q.name, q.valueProvider])).toEqual([
        ["competence", "modelOptional"], ["page", "modelOptional"], ["pageSize", "modelOptional"],
      ]);
      const cab = Object.fromEntries(t.parameters.parametersHeaders.values.map((h: any) => [h.name, h.value]));
      expect(cab["X-B2C-Source"]).toBe("telegram");
      expect(cab["X-B2C-Identity"]).toBe("={{ $json.identityId }}");
      expect(t.parameters.toolDescription).toContain("QUALQUER competência");
      expect(t.credentials.httpHeaderAuth.id).toBe("CONFIGURAR_B2C_FINANCE_API");
    }
  });

  it("o somente leitura continua sem escrita (12 consultas + conhecimento)", () => {
    expect(ferramentas(TG_LEITURA)).toEqual([
      "buscar_clientes", "consultar_caixa", "consultar_cliente", "consultar_conhecimento", "consultar_dashboard", "consultar_despesas",
      "consultar_inadimplencia", "consultar_rotina", "consultar_status_cliente", "consultar_upsells", "consultar_recebimentos",
      "gerar_relatorio_diario", "gerar_relatorio_mensal",
    ].sort());
    for (const n of TG_LEITURA.nodes.filter((x: any) => /httpRequest/.test(x.type))) {
      expect(n.parameters.method ?? "GET", n.name).toMatch(/GET|POST/);
      if (n.parameters.method === "POST") expect(n.parameters.url).toContain("/integrations/resolve-identity");
    }
    expect(TG_LEITURA.active).toBe(false);
    expect(TG_ESCRITA.active).toBe(false);
  });

  it("liberada só com scope receivables.read E permissão recebimentos.ver_inadimplencia (vindas da API)", async () => {
    for (const w of [TG_LEITURA, TG_ESCRITA]) {
      const js = no(w, "Carregar permissões").parameters.jsCode as string;
      const rodar = async (data: any) =>
        (await new Function("$", "$input", `return (async () => { ${js} })();`)(
          () => ({ all: () => [{ json: { fromId: "1", chatId: 1 } }] }),
          { all: () => [{ json: { success: true, data: { identityId: "i", user: { id: "u", name: "N", roleLabel: "R" }, ...data } } }] }
        ))[0].json.allowedTools as string[];
      expect(await rodar({ allowedScopes: ["receivables.read"], permissions: ["recebimentos.visualizar", "recebimentos.ver_inadimplencia"] })).toContain("consultar_inadimplencia");
      const semPermissao = await rodar({ allowedScopes: ["receivables.read"], permissions: ["recebimentos.visualizar"] });
      expect(semPermissao).not.toContain("consultar_inadimplencia");
      expect(semPermissao).toContain("consultar_recebimentos");
      expect(await rodar({ allowedScopes: ["clients.read"], permissions: ["recebimentos.ver_inadimplencia"] })).not.toContain("consultar_inadimplencia");
      expect(await rodar({ allowedScopes: ["receivables.read"] })).not.toContain("consultar_inadimplencia"); // sem lista = sem permissão
    }
  });
});

describe("WhatsApp preservado", () => {
  it("os agentes do WhatsApp mantêm as mesmas ferramentas (sem a nova)", () => {
    for (const f of ["b2c-finance-ai-agent-readonly.json", "b2c-finance-ai-agent.json"]) {
      const w = ler(f);
      expect(ferramentas(w)).not.toContain("consultar_inadimplencia");
      expect(JSON.stringify(w)).not.toContain("/receivables/delinquency");
    }
  });
});

describe("descrições e prompt", () => {
  it("consultar_recebimentos: DELINQUENT não é toda a inadimplência; vazio vale só para a janela; aponta a ferramenta certa", () => {
    const d = no(TG_LEITURA, "consultar_recebimentos").parameters.toolDescription as string;
    expect(d).toContain("DELINQUENT (SÓ as escaladas manualmente — não é toda a inadimplência)");
    expect(d).toContain("NÃO use para \"quem está inadimplente\"");
    expect(d).toContain("Lista vazia vale SÓ para a janela consultada");
    expect(d).toContain("consultar_inadimplencia");
    expect(no(TG_LEITURA, "consultar_rotina").parameters.toolDescription).toContain("nunca a use como lista completa de inadimplentes");
  });

  it("prompt dos agentes do Telegram: inadimplência atual, recorte, vazio ≠ zero global, lista parcial com total, nada do Qdrant", () => {
    for (const w of [TG_LEITURA, TG_ESCRITA]) {
      const p = no(w, AGENTE_TG[w.name]).parameters.options.systemMessage as string;
      for (const trecho of [
        "`consultar_inadimplencia` SEM mês: é a posição ATUAL, de todas as competências",
        "nunca use `DELINQUENT` como sinônimo de inadimplência",
        "Resultado vazio vale só para o recorte consultado",
        "Erro ou consulta incompleta → diga que não conseguiu consultar, nunca \"zero\"",
        "Sempre informe o recorte e a data da posição",
        "nunca some só a página para dar o total",
        "nunca da base de conhecimento nem da memória da conversa",
        "é a fila de trabalho do dia",
      ]) expect(p, trecho).toContain(trecho);
    }
  });
});
