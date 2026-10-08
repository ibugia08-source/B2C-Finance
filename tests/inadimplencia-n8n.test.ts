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
      expect(t.credentials.httpHeaderAuth.id).toBe(w === TG_LEITURA ? "CONFIGURAR_B2C_FINANCE_API" : "CONFIGURAR_B2C_FINANCE_API_ESCRITA");
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

describe("Ver mais na lista de inadimplentes do agente somente leitura", () => {
  const executar = async (nome: string, itens: any[], contexto?: any) => {
    const js = no(TG_LEITURA, nome).parameters.jsCode as string;
    const $ = () => ({ all: () => [{ json: contexto }] });
    return await new Function("$input", "$", `return (async () => { ${js} })();`)(
      { all: () => itens.map((json) => ({ json })) }, $
    ) as any[];
  };

  it("clique e mensagem passam novamente pelo vínculo e permissões; página não autorizada não chega à API", async () => {
    expect(no(TG_LEITURA, "Telegram: receber mensagem").parameters.updates).toEqual(["message", "callback_query"]);
    const [clique] = await executar("Normalizar update", [{ update_id: 7, callback_query: {
      id: "cb7", data: "inad:2", from: { id: 42, is_bot: false },
      message: { message_id: 9, chat: { id: 42, type: "private" } },
    } }]);
    expect(clique.json).toMatchObject({ fromId: "42", chatType: "private", callbackData: "inad:2", tipo: "callback" });
    expect(TG_LEITURA.connections["Deduplicar update (update_id)"].main[0][0].node).toBe("Chat privado?");
    expect(TG_LEITURA.connections["Extrair Telegram User ID"].main[0][0].node).toBe("API: resolver identidade");
    expect(TG_LEITURA.connections["Carregar permissões"].main[0][0].node).toBe("Roteiro da mensagem");
    const base = { ...clique.json, authorized: true, allowedTools: ["consultar_inadimplencia"] };
    const [pagina2] = await executar("Roteiro da mensagem", [base]);
    expect(pagina2.json).toMatchObject({ rota: "inadimplencia", pagina: 2 });
    const [bloqueado] = await executar("Roteiro da mensagem", [{ ...base, allowedTools: [] }]);
    expect(bloqueado.json.rota).toBe("responder");
    const [inicio] = await executar("Roteiro da mensagem", [{ ...base, tipo: "text", text: "Liste os clientes inadimplentes", callbackData: undefined }]);
    expect(inicio.json).toMatchObject({ rota: "inadimplencia", pagina: 1 });
    const [comMes] = await executar("Roteiro da mensagem", [{ ...base, tipo: "text", text: "Liste os inadimplentes de setembro", callbackData: undefined }]);
    expect(comMes.json).toMatchObject({ rota: "inadimplencia", competencia: "2026-09", pagina: 1 });
    const [naoPagaram] = await executar("Roteiro da mensagem", [{ ...base, tipo: "text", text: "Liste quais clientes ativos ainda não pagaram no mês de outubro" }]);
    expect(naoPagaram.json).toMatchObject({ rota: "responder" });
    expect(naoPagaram.json.texto).toContain("ainda vão vencer");
    const [outubro] = await executar("Roteiro da mensagem", [{ ...base, tipo: "text", text: "Liste os inadimplentes de outubro de 2026" }]);
    expect(outubro.json).toMatchObject({ rota: "inadimplencia", competencia: "2026-10", pagina: 1 });
    const [cliqueOutubro] = await executar("Roteiro da mensagem", [{ ...base, tipo: "callback", callbackData: "inad:2:2026-10" }]);
    expect(cliqueOutubro.json).toMatchObject({ rota: "inadimplencia", competencia: "2026-10", pagina: 2 });
  });

  it("busca 10 por página na API B2C e apresenta todos os 18 itens em duas páginas com botão só na primeira", async () => {
    const api = no(TG_LEITURA, "API: página de inadimplentes");
    expect(api.parameters).toMatchObject({ method: "GET", authentication: "genericCredentialType" });
    expect(api.parameters.url).toContain("/receivables/delinquency{{ $json.competencia ? '?competence='");
    expect(api.parameters.queryParameters.parameters).toEqual([
      { name: "page", value: "={{ $json.pagina }}" }, { name: "pageSize", value: "10" },
    ]);
    const headers = Object.fromEntries(api.parameters.headerParameters.parameters.map((h: any) => [h.name, h.value]));
    expect(headers["X-B2C-Source"]).toBe("telegram");
    expect(headers["X-B2C-Identity"]).toBe("={{ $json.identityId }}");
    const todos = Array.from({ length: 18 }, (_, i) => ({ client: { name: i === 0 ? "Cliente <A>" : `Cliente ${i + 1}` }, overdueAmount: 100 + i, billingCount: 1, daysOverdue: i + 1 }));
    const meta = { asOf: "2026-09-29", scope: { kind: "all_open" }, totals: { clients: 18, billings: 19, overdueAmount: 28440 } };
    const [primeira] = await executar("Formatar página de inadimplentes", [{ success: true, data: todos.slice(0, 10), meta }], { chatId: 42, pagina: 1 });
    const [segunda] = await executar("Formatar página de inadimplentes", [{ success: true, data: todos.slice(10), meta }], { chatId: 42, pagina: 2 });
    expect(primeira.json.nextPage).toBe(2);
    expect(primeira.json.nextCallbackData).toBe("inad:2");
    expect(segunda.json.nextPage).toBeNull();
    expect(primeira.json.text).toContain("Cliente &lt;A&gt;");
    expect(primeira.json.text).not.toContain("Cliente 11");
    expect(segunda.json.text).toContain("Cliente 18");
    expect(segunda.json.text).not.toContain("Cliente 1 —");
    for (const pagina of [primeira, segunda]) {
      expect(pagina.json.text).toContain("18 clientes");
      expect(pagina.json.text).toContain("19 cobranças vencidas");
      expect(pagina.json.text).toContain("28.440,00");
      expect(pagina.json.text).toContain("29/09/2026");
    }
    const enviar = no(TG_LEITURA, "Telegram: enviar página de inadimplentes");
    expect(enviar.parameters.replyMarkup).toContain("$json.nextPage ? 'inlineKeyboard' : 'none'");
    expect(enviar.parameters.inlineKeyboard.rows[0].row.buttons[0]).toMatchObject({ text: "Ver mais", additionalFields: { callback_data: "={{ $json.nextCallbackData }}" } });
    const [periodoErrado] = await executar("Formatar página de inadimplentes", [{ success: true, data: [], meta }], { chatId: 42, pagina: 1, competencia: "2026-10" });
    expect(periodoErrado.json.text).toContain("período diferente");
    const [comPeriodo] = await executar("Formatar página de inadimplentes", [{ success: true, data: todos.slice(0, 10), meta: { ...meta, scope: { kind: "competence", competence: "2026-10" } } }], { chatId: 42, pagina: 1, competencia: "2026-10" });
    expect(comPeriodo.json.nextCallbackData).toBe("inad:2:2026-10");
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
    expect(d).toContain("DELINQUENT (só escaladas manualmente)");
    expect(d).toContain("NÃO use para 'quem está inadimplente'");
    expect(d).toContain("Lista vazia vale só para meta.window");
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
        "nunca some só a página",
        "nunca da base de conhecimento nem da memória da conversa",
        "é a fila de trabalho do dia",
      ]) expect(p, trecho).toContain(trecho);
    }
  });
});
