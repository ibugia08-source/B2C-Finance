import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { OPERACOES_BLOQUEADAS, OPERACOES_DE_ESCRITA, FERRAMENTAS_DE_LEITURA } from "@/lib/api/agent/catalog";

/**
 * TELEGRAM · BLOCO 2 (workflows versionados) — agente com escrita,
 * botões de confirmação e relatórios diários.
 *  · o agente tem as 11 consultas + as 10 escritas (que só PROPÕEM), nenhuma
 *    operação bloqueada, tudo com X-B2C-Source telegram e delegação;
 *  · o botão leva só "confirm:<id>"/"cancel:<id>" (≤ 64 bytes) — a API é quem
 *    decide; Idempotency-Key telegram:<update_id>:<id>;
 *  · a lógica dos nós (normalizar botão, roteiro, decidir, resultado) roda
 *    aqui com entradas simuladas;
 *  · relatórios: destinatários pela API (preferência), um relatório por
 *    pessoa com o RBAC dela, mesma consolidação do WhatsApp.
 */

const RAIZ = join(process.cwd(), "integrations/n8n/workflows");
const ler = (f: string) => JSON.parse(readFileSync(join(RAIZ, f), "utf8"));
const no = (w: any, nome: string) => w.nodes.find((n: any) => n.name === nome);
const prox = (w: any, n: string, saida = 0) => (w.connections[n]?.main?.[saida] ?? []).map((c: any) => c.node);

const wf = ler("b2c-finance-telegram-agent.json");
const js = (nome: string) => no(wf, nome).parameters.jsCode as string;

/** Executa o código de um nó Code com entradas simuladas. */
async function rodar(nome: string, itens: any[], nos: Record<string, any[]> = {}, estatico: any = {}) {
  const $ = (n: string) => ({
    all: () => (nos[n] ?? []).map((json) => ({ json })),
    first: () => ({ json: (nos[n] ?? [])[0] }),
    itemMatching: (i: number) => ({ json: (nos[n] ?? [])[i] }),
  });
  const fn = new Function("$input", "$", "$getWorkflowStaticData", `return (async () => { ${js(nome)} })();`);
  return ((await fn({ all: () => itens.map((json) => ({ json })) }, $, () => estatico)) as any[]).map((i) => i.json);
}

describe("Telegram · agente com escrita (workflow)", () => {
  it("'quanto recebemos hoje' usa pagamentos confirmados do relatório, nunca cobranças que vencem", async () => {
    const [pedido] = await rodar("Roteiro da mensagem", [{
      authorized: true, tipo: "text", text: "Quanto recebemos hoje?", chatId: 12,
      allowedTools: ["gerar_relatorio_diario"],
    }]);
    expect(pedido.rota).toBe("recebidos_hoje");
    expect(prox(wf, "Rota", 5)).toEqual(["API: relatório diário para recebidos"]);
    const [resposta] = await rodar("Formatar pagamentos recebidos hoje", [{
      success: true, data: { date: pedido.dataConsulta, receivables: {
        dueToday: { amount: 3400, count: 4 }, received: { amount: 1200, count: 1 },
      } }, meta: { omittedSections: [] },
    }], { "Roteiro da mensagem": [pedido] });
    expect(resposta.texto).toContain("R$ 1.200,00");
    expect(resposta.texto).not.toContain("3.400,00");
    expect(resposta.texto).toContain("1 pagamento(s) confirmado(s)");
  });

  it("cadastro Telegram aceita prospect por nome e transmite o objeto para a API sem o parser JSON do n8n", () => {
    const t = no(wf, "cadastrar_cliente");
    const corpo = t.parameters.jsonBody as string;
    expect(corpo).toContain("JSON.parse($fromAI('input'");
    expect(corpo).toContain("initialStatus");
    const expr = corpo.replace(/^=\{\{/, "").replace(/\}\}$/, "");
    const parsed = JSON.parse(new Function("$fromAI", `return ${expr};`)((chave: string) => {
      expect(chave).toBe("input");
      return JSON.stringify({ name: "Cliente Exemplo", initialStatus: "PROSPECT" });
    }));
    expect(parsed).toEqual({ operation: "clients.create", input: { name: "Cliente Exemplo", initialStatus: "PROSPECT" } });
  });

  it("existe, está desativado e escuta mensagens E botões (callback_query)", () => {
    expect(wf.active).toBe(false);
    const g = no(wf, "Telegram: receber mensagem ou botão");
    expect(g.type).toBe("n8n-nodes-base.telegramTrigger");
    expect(g.parameters.updates).toEqual(["message", "callback_query"]);
    expect(g.credentials.telegramApi.id).toBe("CONFIGURAR_TELEGRAM");
    expect(wf.meta.b2c.readOnly).toBe(false);
    expect(wf.meta.b2c.writeMode).toBe("confirmation-buttons");
  });

  it("ferramentas: 11 consultas + 10 escritas que só propõem; nenhuma bloqueada; origem telegram", () => {
    const ferramentas = wf.nodes.filter((n: any) => wf.connections[n.name]?.ai_tool);
    const nomes = ferramentas.map((n: any) => n.name).sort();
    const escrita = Object.values(OPERACOES_DE_ESCRITA).map((o) => o.tool);
    expect(nomes).toEqual([...FERRAMENTAS_DE_LEITURA, ...escrita, "consultar_conhecimento"].sort());
    for (const b of Object.keys(OPERACOES_BLOQUEADAS)) expect(JSON.stringify(wf)).not.toContain(`'${b}'`);
    expect(JSON.stringify(wf)).not.toMatch(/method":\s*"DELETE/);
    for (const [op, def] of Object.entries(OPERACOES_DE_ESCRITA)) {
      const n = no(wf, def.tool);
      expect(n.type).toBe("n8n-nodes-base.httpRequestTool");
      expect(n.parameters.method).toBe("POST");
      expect(n.parameters.url).toContain("/agent/pending-actions");
      expect(n.parameters.url).toContain(`includes('${def.tool}')`); // fora do perfil = host inválido
      expect(n.parameters.jsonBody).toContain(`operation: '${op}'`); // operação FIXA
      const cab = Object.fromEntries(n.parameters.headerParameters.parameters.map((h: any) => [h.name, h.value]));
      expect(cab["X-B2C-Source"]).toBe("telegram");
      expect(cab["X-B2C-Identity"]).toBe("={{ $json.identityId }}");
      expect(cab["X-B2C-Message-Id"]).toBe("={{ $json.messageId }}");
    }
    for (const t of FERRAMENTAS_DE_LEITURA) {
      const v = no(wf, t).parameters.parametersHeaders.values.find((h: any) => h.name === "X-B2C-Source");
      expect(v.value).toBe("telegram");
    }
    // Nenhum nó HTTP fora das ferramentas escreve no negócio: só pending-actions e resolve-identity.
    for (const n of wf.nodes.filter((x: any) => x.type === "n8n-nodes-base.httpRequest" && x.parameters.method === "POST")) {
      expect(n.parameters.url).toMatch(/\/integrations\/resolve-identity$|\/agent\/pending-actions\/\{\{ \$json\.actionId \}\}\/(confirm|cancel)$/);
    }
  });

  it("usa uma credencial B2C de escrita separada da credencial do fallback", () => {
    const b2c = wf.nodes.filter((n: any) => n.credentials?.httpHeaderAuth);
    expect(b2c.length).toBeGreaterThan(15);
    for (const n of b2c) expect(n.credentials.httpHeaderAuth).toEqual({
      id: "CONFIGURAR_B2C_FINANCE_API_ESCRITA",
      name: "B2C Finance API — escrita Telegram",
    });
    const fallback = ler("b2c-finance-telegram-agent-readonly.json");
    for (const n of fallback.nodes.filter((x: any) => x.credentials?.httpHeaderAuth)) {
      expect(n.credentials.httpHeaderAuth.name).toBe("B2C Finance API");
    }
  });

  it("fluxo: botão → valida → GET da ação → confirmar/cancelar → responde o botão e edita a prévia", () => {
    expect(prox(wf, "Rota", 2)).toEqual(["Interpretar botão"]);
    expect(prox(wf, "Interpretar botão")).toEqual(["Botão válido?"]);
    expect(prox(wf, "Botão válido?", 0)).toEqual(["API: consultar ação"]);
    expect(no(wf, "API: consultar ação").parameters.method).toBe("GET");
    expect(no(wf, "API: consultar ação").parameters.url).toContain("/agent/pending-actions/{{ $json.actionId }}");
    expect(prox(wf, "API: consultar ação")).toEqual(["Decidir botão"]);
    expect(prox(wf, "Confirmar ou cancelar?", 0)).toEqual(["API: confirmar ação"]);
    expect(prox(wf, "Confirmar ou cancelar?", 1)).toEqual(["API: cancelar ação"]);
    expect(prox(wf, "Resposta do botão").sort()).toEqual(["Atualizar a prévia?", "Telegram: responder ao botão"]);
    const conf = no(wf, "API: confirmar ação").parameters;
    const cab = Object.fromEntries(conf.headerParameters.parameters.map((h: any) => [h.name, h.value]));
    expect(cab["Idempotency-Key"]).toBe("={{ $json.idempotencyKey }}");
    expect(cab["X-B2C-Identity"]).toBe("={{ $json.identityId }}"); // vínculo de quem TOCOU
    expect(cab["X-B2C-Source"]).toBe("telegram");
    expect(conf.jsonBody).toContain("via: 'button'");
    expect(conf.jsonBody).not.toMatch(/amount|input|payload|confirmationCode/); // a confirmação não leva a ação
    expect(no(wf, "Telegram: responder ao botão").parameters.operation).toBe("answerQuery");
    const ed = no(wf, "Telegram: atualizar prévia").parameters;
    expect(ed.operation).toBe("editMessageText");
    expect(ed.replyMarkup).toBe("none"); // a prévia perde os botões
    expect(ed.additionalFields.parse_mode).toBe("HTML");
  });

  it("teclado inline: só a referência da ação no callback_data, dentro do limite de 64 bytes", () => {
    const n = no(wf, "Telegram: enviar prévia com botões");
    expect(n.parameters.replyMarkup).toBe("inlineKeyboard");
    const botoes = n.parameters.inlineKeyboard.rows[0].row.buttons;
    expect(botoes.map((b: any) => b.text)).toEqual(["Confirmar", "Cancelar"]);
    expect(botoes.map((b: any) => b.additionalFields.callback_data)).toEqual([
      "={{ 'confirm:' + $json.actionId }}",
      "={{ 'cancel:' + $json.actionId }}",
    ]);
    const cuid = "cmulpa1zb000l1128ekc74ofv";
    expect(Buffer.byteLength(`confirm:${cuid}`)).toBeLessThanOrEqual(64);
    // A prévia vem da API; o agente e a resposta em texto chegam no mesmo envio.
    expect(prox(wf, "Tem prévia para confirmar?", 0)).toEqual(["Telegram: enviar prévia com botões"]);
    expect(prox(wf, "Há ação aguardando?", 0)).toEqual(["Telegram: enviar prévia com botões"]);
  });

  it("normaliza o toque no botão: identidade = from.id de quem tocou; dados só do callback", async () => {
    const [b] = await rodar("Normalizar update (mensagem ou botão)", [{
      update_id: 815000123,
      callback_query: {
        id: "4382bfdwdsb323b2d9", data: "confirm:cmupa0001",
        from: { id: 123456789, is_bot: false, username: "joao_b2c" },
        message: { message_id: 77, chat: { id: 123456789, type: "private" } },
      },
    }]);
    expect(b).toMatchObject({
      tipo: "callback", updateId: 815000123, fromId: "123456789", chatType: "private",
      callbackQueryId: "4382bfdwdsb323b2d9", callbackData: "confirm:cmupa0001", callbackMessageId: 77,
    });
    const [m] = await rodar("Normalizar update (mensagem ou botão)", [{
      update_id: 1, message: { message_id: 9, chat: { id: 5, type: "private" }, from: { id: 5, is_bot: false }, text: "/status" },
    }]);
    expect(m).toMatchObject({ tipo: "text", comando: "/status", messageId: "tg:5:9" });
  });

  it("interpreta o botão: formato estrito, chave telegram:<update_id>:<id>; lixo e não vinculado não chegam à API", async () => {
    const base = { authorized: true, callbackQueryId: "q", chatId: 1, callbackMessageId: 2, updateId: 99, identityId: "idt" };
    const [ok] = await rodar("Interpretar botão", [{ ...base, callbackData: "confirm:cmupa0001" }]);
    expect(ok).toMatchObject({ valido: true, decisao: "confirmar", actionId: "cmupa0001", idempotencyKey: "telegram:99:cmupa0001" });
    const [canc] = await rodar("Interpretar botão", [{ ...base, callbackData: "cancel:cmupa0001" }]);
    expect(canc.decisao).toBe("cancelar");
    for (const lixo of ["confirm:", "delete:cmupa0001", "confirm:../x", "confirm:a b", '{"amount":1500}', ""]) {
      const [r] = await rodar("Interpretar botão", [{ ...base, callbackData: lixo }]);
      expect(r.valido, lixo).toBe(false);
    }
    const [anon] = await rodar("Interpretar botão", [{ ...base, authorized: false, motivo: "numero_nao_vinculado", callbackData: "confirm:x1" }]);
    expect(anon.valido).toBe(false);
    expect(anon.toast).toContain("não está vinculado");
  });

  it("decide pelo estado da API: só PENDING executa; executada/cancelada/expirada/de outro usuário não", async () => {
    const botao = { valido: true, decisao: "confirmar", actionId: "a1", idempotencyKey: "telegram:1:a1", callbackQueryId: "q", chatId: 1, callbackMessageId: 2 };
    const decidir = async (resp: any) => (await rodar("Decidir botão", [resp], { "Interpretar botão": [botao] }))[0];
    const pend = await decidir({ success: true, data: { status: "PENDING", preview: "Encontrei:\n*Face Love*" } });
    expect(pend.proximo).toBe("confirmar");
    const feita = await decidir({ success: true, data: { status: "EXECUTED", preview: "Encontrei:\n*Face Love*" } });
    expect(feita).toMatchObject({ proximo: "fim", toast: "Essa ação já foi processada.", editar: true });
    expect(feita.text).toContain("<b>Face Love</b>");
    const vencida = await decidir({ success: true, data: { status: "EXPIRED", preview: "x" } });
    expect(vencida.proximo).toBe("fim");
    expect(vencida.toast).toContain("prazo");
    const cancelada = await decidir({ success: true, data: { status: "CANCELLED", preview: "x" } });
    expect(cancelada.proximo).toBe("fim");
    const outro = await decidir({ success: false, error: { code: "not_found" } });
    expect(outro).toMatchObject({ proximo: "fim", toast: "Ação não encontrada.", editar: false });
    const semPermissao = await decidir({ success: false, error: { code: "insufficient_scope" } });
    expect(semPermissao).toMatchObject({ proximo: "fim", toast: "Você não possui permissão para esta ação.", editar: false });
  });

  it("resultado vem da API (não da IA), escapado; conflito vira 'já foi processada'", async () => {
    const ctx = { decisao: "confirmar", preview: "Encontrei:\n*A<b>C*", callbackQueryId: "q", chatId: 1, callbackMessageId: 2 };
    const res = async (r: any) => (await rodar("Resultado da ação", [r], { "Decidir botão": [ctx] }))[0];
    const ok = await res({ success: true, data: { status: "EXECUTED", message: "✅ Pagamento registrado — Face Love (R$ 1.500,00)." } });
    expect(ok.toast).toContain("Pagamento registrado");
    expect(ok.text).toContain("<b>A&lt;b&gt;C</b>"); // nada vira tag
    expect(ok.text).toContain("Pagamento registrado");
    const dup = await res({ success: false, error: { code: "action_not_pending", message: "Esta ação já foi executada." } });
    expect(dup.toast).toBe("Essa ação já foi processada.");
  });

  it("roteiro: /help com exemplos de escrita, /status sem segredos, 'sim' digitado não vai para a IA", async () => {
    const base = { authorized: true, userName: "Israel", roleLabel: "Administrador", fromId: "1", tipo: "text", allowedTools: ["consultar_caixa", "registrar_pagamento"] };
    const [help] = await rodar("Roteiro da mensagem", [{ ...base, comando: "/help", text: "/help" }]);
    for (const ex of ["Quanto recebemos hoje?", "Quem está inadimplente?", "Qual nosso MRR?", "A Face Love pagou R$ 1.500 hoje.", "Deixe a Alpha inativa a partir de outubro.", "Crie uma oportunidade de upsell de Google Ads"]) {
      expect(help.texto).toContain(ex);
    }
    expect(help.texto).toMatch(/Confirmar.*Cancelar/);
    const [st] = await rodar("Roteiro da mensagem", [{ ...base, comando: "/status", text: "/status", identityId: "cmuwa0001", allowedScopes: ["cash.read"] }]);
    expect(st.texto).toContain("Canal: Telegram");
    expect(st.texto).toContain("Agente: Leitura e ações controladas");
    expect(st.texto).not.toMatch(/cmuwa0001|cash\.read|token/i);
    const [so] = await rodar("Roteiro da mensagem", [{ ...base, comando: "/status", text: "/status", allowedTools: ["consultar_caixa"] }]);
    expect(so.texto).toContain("Somente leitura");
    for (const t of ["sim", "SIM 4821", "não", "Cancelar"]) {
      const [r] = await rodar("Roteiro da mensagem", [{ ...base, comando: null, text: t }]);
      expect(r.rota, t).toBe("resposta_em_texto");
    }
    const [bt] = await rodar("Roteiro da mensagem", [{ ...base, tipo: "callback", comando: null, text: "" }]);
    expect(bt.rota).toBe("botao");
    const [ag] = await rodar("Roteiro da mensagem", [{ ...base, comando: null, text: "A Face Love pagou 1500 hoje." }]);
    expect(ag.rota).toBe("agente");
  });

  it("paginação de inadimplentes mantém vínculo e permissão e não corta a resposta", async () => {
    expect(prox(wf, "Rota", 4)).toEqual(["É clique em Ver mais?", "API: página de inadimplentes"]);
    expect(prox(wf, "É clique em Ver mais?", 0)).toEqual(["Telegram: confirmar Ver mais"]);
    expect(prox(wf, "API: página de inadimplentes")).toEqual(["Formatar página de inadimplentes"]);
    expect(prox(wf, "Formatar página de inadimplentes")).toEqual(["Telegram: enviar página de inadimplentes"]);
    const base = { tipo: "callback", callbackData: "inad:2", authorized: true, allowedTools: ["consultar_inadimplencia"] };
    expect((await rodar("Roteiro da mensagem", [base]))[0]).toMatchObject({ rota: "inadimplencia", pagina: 2 });
    expect((await rodar("Roteiro da mensagem", [{ ...base, allowedTools: [] }]))[0].rota).toBe("botao");
    expect((await rodar("Roteiro da mensagem", [{ ...base, authorized: false }]))[0].rota).toBe("botao");
    expect((await rodar("Roteiro da mensagem", [{ ...base, tipo: "text", text: "Liste os clientes inadimplentes" }]))[0]).toMatchObject({ rota: "inadimplencia", pagina: 1 });
    expect((await rodar("Roteiro da mensagem", [{ ...base, tipo: "text", text: "Liste os inadimplentes de setembro de 2026" }]))[0]).toMatchObject({ rota: "inadimplencia", competencia: "2026-09" });
    expect((await rodar("Roteiro da mensagem", [{ ...base, tipo: "text", text: "Liste quais clientes ativos ainda não pagaram no mês de outubro" }]))[0].rota).toBe("responder");
    const api = no(wf, "API: página de inadimplentes").parameters;
    expect(api.method).toBe("GET");
    expect(api.url).toContain("/receivables/delinquency{{ $json.competencia ? '?competence='");
    expect(api.queryParameters.parameters).toContainEqual({ name: "pageSize", value: "10" });
    expect(api.headerParameters.parameters).toContainEqual({ name: "X-B2C-Identity", value: "={{ $json.identityId }}" });
    const clientes = Array.from({ length: 18 }, (_, i) => ({ client: { name: `Cliente ${i + 1}` }, overdueAmount: 100, billingCount: 1, daysOverdue: 1 }));
    const meta = { asOf: "2026-09-29", scope: { kind: "all_open" }, totals: { clients: 18, billings: 18, overdueAmount: 1800 } };
    const p1 = (await rodar("Formatar página de inadimplentes", [{ success: true, data: clientes.slice(0, 10), meta }], { "Roteiro da mensagem": [{ chatId: 1, pagina: 1 }] }))[0];
    const p2 = (await rodar("Formatar página de inadimplentes", [{ success: true, data: clientes.slice(10), meta }], { "Roteiro da mensagem": [{ chatId: 1, pagina: 2 }] }))[0];
    expect(p1.nextPage).toBe(2);
    expect(p1.text).not.toContain("Cliente 11");
    expect(p2.nextPage).toBeNull();
    expect(p2.text).toContain("Cliente 18");
    expect(no(wf, "Telegram: enviar página de inadimplentes").parameters.inlineKeyboard.rows[0].row.buttons[0].additionalFields.callback_data).toBe("={{ $json.nextCallbackData }}");
    expect(js("Formatar para o Telegram")).toContain("const MAX_PARTES = 0");
    expect(js("Formatar para o Telegram")).not.toContain("Resposta longa — peça um recorte menor");
  });

  it("'sim' digitado com ação aguardando reenvia a prévia com botões; sem ação, responde sem IA", async () => {
    const msg = { chatId: 9, text: "sim", identityId: "i" };
    const com = (await rodar("Decidir resposta em texto", [{ success: true, data: [{ actionId: "a1", status: "PENDING", message: "Encontrei:\n*X*\n\nToque em *Confirmar* ou *Cancelar*." }] }], { "Roteiro da mensagem": [msg] }))[0];
    expect(com).toMatchObject({ pendente: true, actionId: "a1", chatId: 9 });
    expect(com.text).toContain("<b>Confirmar</b>");
    const sem = (await rodar("Decidir resposta em texto", [{ success: true, data: [] }], { "Roteiro da mensagem": [msg] }))[0];
    expect(sem.pendente).toBe(false);
    expect(sem.texto).toContain("Não há ação aguardando confirmação");
    expect(prox(wf, "Há ação aguardando?", 1)).toEqual(["Formatar para o Telegram"]);
    const falha = (await rodar("Decidir resposta em texto", [{ success: false, error: { code: "upstream_error" } }], { "Roteiro da mensagem": [msg] }))[0];
    expect(falha).toMatchObject({ pendente: false, falhaApi: true });
    expect(falha.texto).toContain("Não consegui verificar");
  });

  it("depois da IA: proposta desta mensagem → prévia da API com botões; senão, o texto", async () => {
    const ctx = { chatId: 3, output: "Preparei a confirmação.", messageId: "tg:3:1" };
    const [p] = await rodar("Interpretar resposta do agente", [{ success: true, data: [{ actionId: "a9", status: "PENDING", message: "Encontrei:\n*Face Love*\nValor: R$ 1.500,00" }] }], { "Juntar resposta e contexto": [ctx] });
    expect(p).toMatchObject({ comPrevia: true, actionId: "a9", chatId: 3 });
    expect(p.text).toContain("<b>Face Love</b>");
    const [t] = await rodar("Interpretar resposta do agente", [{ success: true, data: [] }], { "Juntar resposta e contexto": [ctx] });
    expect(t).toMatchObject({ comPrevia: false });
    expect(t.output).toContain("Nada foi alterado");
    const [normal] = await rodar("Interpretar resposta do agente", [{ success: true, data: [] }], { "Juntar resposta e contexto": [{ ...ctx, output: "Encontrei dois clientes. Qual deles?" }] });
    expect(normal.output).toBe("Encontrei dois clientes. Qual deles?");
  });

  it("prompt: base + escrita, confirmação por botões no Telegram, regras de status temporal e bloqueio", () => {
    const prompt = no(wf, "AI Agent B2C Finance (Telegram)").parameters.options.systemMessage as string;
    expect(prompt).toContain("Modo desta versão: consulta + escrita com confirmação");
    expect(prompt).toContain("Canal: Telegram");
    expect(prompt).toContain("botões Confirmar e Cancelar");
    expect(prompt).toContain("effectiveFrom");
    expect(prompt).toMatch(/Nunca use `editar_cliente` para status/);
    expect(prompt).toContain("Pedido BLOCKED");
  });
});

describe("Telegram · relatórios diários (workflows)", () => {
  const manha = ler("telegram-daily-morning-report.json");
  const noite = ler("telegram-daily-evening-report.json");
  const waManha = ler("daily-morning-report.json");

  it("desativados; destinatários pela API (preferência), nunca por variável", () => {
    for (const [w, fin] of [[manha, "morning_report"], [noite, "evening_report"]] as const) {
      expect(w.active).toBe(false);
      expect(no(w, "API: destinatários").parameters.url).toContain(`/integrations/recipients?channel=TELEGRAM&purpose=${fin}`);
      expect(JSON.stringify(w)).not.toContain("B2C_REPORT_RECIPIENTS");
      expect(w.settings.timezone).toBe("America/Bahia");
    }
  });

  it("um relatório por pessoa, com o RBAC dela (X-B2C-Identity), só GET na API", () => {
    for (const w of [manha, noite]) {
      expect(no(w, "Um destinatário por vez").type).toBe("n8n-nodes-base.splitInBatches");
      expect(prox(w, "Um destinatário por vez", 1)).toEqual(["Preparar data e destinatários"]);
      expect(prox(w, "Telegram: enviar relatório")).toEqual(["Um destinatário por vez"]);
      const gets = w.nodes.filter((n: any) => n.type === "n8n-nodes-base.httpRequest" && n.name !== "API: destinatários");
      expect(gets.length).toBeGreaterThan(1);
      for (const g of gets) {
        expect(g.parameters.method ?? "GET").toBe("GET");
        const cab = Object.fromEntries(g.parameters.headerParameters.parameters.map((h: any) => [h.name, h.value]));
        // $node[…]: no loop, $('…').first() em parâmetro HTTP não resolve no n8n 1.123 (cabeçalho sairia vazio).
        expect(cab["X-B2C-Identity"]).toBe("={{ $node['Preparar data e destinatários'].json.identityId }}");
        expect(g.parameters.url).not.toContain("$('");
        expect(cab["X-B2C-Source"]).toBe("telegram");
      }
      const env = no(w, "Telegram: enviar relatório");
      expect(env.parameters.additionalFields.parse_mode).toBe("HTML");
      expect(env.credentials.telegramApi.id).toBe("CONFIGURAR_TELEGRAM");
    }
  });

  it("a manhã usa a MESMA consolidação e validação do WhatsApp (não há segunda implementação)", () => {
    expect(no(manha, "Consolidar dados").parameters.jsCode).toBe(no(waManha, "Consolidar dados").parameters.jsCode);
    expect(no(manha, "Validar mensagem").parameters.jsCode).toBe(no(waManha, "Validar mensagem").parameters.jsCode);
  });

  it("destinatários: vazio = nada enviado; API fora = erro visível (não manda relatório vazio)", async () => {
    const itens = no(manha, "Um item por destinatário").parameters.jsCode;
    const exec = (r: any) => new Function("$input", `return (async () => { ${itens} })();`)({ first: () => ({ json: r }) });
    expect(await exec({ success: true, data: { today: "2026-09-28", timezone: "America/Bahia", recipients: [] } })).toEqual([]);
    const dois = await exec({ success: true, data: { today: "2026-09-28", timezone: "America/Bahia", recipients: [
      { identityId: "i1", externalIdentifier: "111", userName: "A" }, { identityId: "i2", externalIdentifier: "222", userName: "B" },
    ] } });
    expect(dois.map((i: any) => i.json.chatId)).toEqual(["111", "222"]);
    expect(dois[0].json).toMatchObject({ hoje: "2026-09-28", tz: "America/Bahia", identityId: "i1" });
    await expect(exec({ success: false, error: { code: "insufficient_scope" } })).rejects.toThrow(/destinatários/);
  });

  it("trava: relatório só é entregue se a API respondeu EM NOME da pessoa (meta.onBehalfOf)", async () => {
    const envio = no(manha, "Preparar envio (Telegram)").parameters.jsCode as string;
    const exec = (respostas: Record<string, any>) =>
      new Function("$", "$json", `return (async () => { ${envio} })();`)(
        (n: string) => ({ first: () => ({ json: n === "Preparar data e destinatários" ? { identityId: "i1", destinatarios: ["111"] } : respostas[n] }) }),
        { destinatarios: ["111"], mensagem: "Bom dia! R$ 1.500,00", origem: "ia" }
      );
    const em = (id: string | null) => ({ success: true, data: {}, meta: id ? { onBehalfOf: { identityId: id } } : {} });
    const ok = await exec({ "API: relatório do dia": em("i1"), "API: rotina do dia": em("i1"), "API: indicadores do mês": { success: false, error: { code: "user_forbidden" } } });
    expect(ok[0].json).toMatchObject({ chatId: "111", texto: "Bom dia! R$ 1.500,00" });
    const semId = await exec({ "API: relatório do dia": em(null), "API: rotina do dia": em("i1"), "API: indicadores do mês": em("i1") });
    expect(semId[0].json.origem).toBe("bloqueado");
    expect(semId[0].json.texto).not.toContain("R$");
    const outro = await exec({ "API: relatório do dia": em("i2"), "API: rotina do dia": em("i1"), "API: indicadores do mês": em("i1") });
    expect(outro[0].json.origem).toBe("bloqueado");
  });

  it("noite: inclui as ações do agente de hoje (da API), sem inventar", async () => {
    const consolidar = no(noite, "Consolidar dados").parameters.jsCode as string;
    const nos: Record<string, any> = {
      "Preparar data e destinatários": { hoje: "2026-09-28", tz: "America/Bahia", destinatarios: ["111"] },
      "API: dados do dia": { success: true, data: {} },
      "API: rotina do dia": { success: true, data: { actions: [] } },
      "API: ações do agente": { success: true, data: [
        { status: "EXECUTED", executedAt: "2026-09-28T15:00:00.000Z", tool: "registrar_pagamento", summary: { label: "Face Love", amount: 1500 } },
        { status: "EXECUTED", executedAt: "2026-09-20T15:00:00.000Z", tool: "criar_despesa", summary: { label: "Canva", amount: 350 } },
        { status: "CANCELLED", executedAt: null, tool: "criar_upsell", summary: { label: "X", amount: 800 } },
      ] },
    };
    const [r] = await new Function("$", `return (async () => { ${consolidar} })();`)((n: string) => ({ first: () => ({ json: nos[n] }) }));
    expect(r.json.mensagemPadrao).toContain("Ações pelo agente");
    expect(r.json.mensagemPadrao).toContain("Face Love");
    expect(r.json.mensagemPadrao).not.toContain("Canva"); // outro dia
    expect(r.json.mensagemPadrao).not.toContain("upsell"); // cancelada
    expect(r.json.valoresPermitidos).toContain("1.500,00");
  });
});
