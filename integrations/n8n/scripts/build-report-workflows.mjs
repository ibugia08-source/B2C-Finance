#!/usr/bin/env node
/**
 * Gera os relatórios diários (n8n):
 *   workflows/daily-morning-report.json            WhatsApp · manhã: o que vence, o que está atrasado, prioridades
 *   workflows/daily-evening-report.json            WhatsApp · noite: o que aconteceu no dia e o que ficou pendente
 *   workflows/telegram-daily-morning-report.json   Telegram · manhã (destinatários e RBAC por pessoa, pela API)
 *   workflows/telegram-daily-evening-report.json   Telegram · noite (idem + ações do agente)
 *
 *   node integrations/n8n/scripts/build-report-workflows.mjs    (parte de npm run n8n:build)
 *
 * Desenho (os dois):
 *   Agendamento (cron por variável) → Preparar data e destinatários
 *   → GETs na API B2C (só leitura) → Consolidar dados (monta a MENSAGEM PADRÃO,
 *     só com o que a API trouxe) → IA organiza a mensagem → Validar mensagem
 *     (todo R$ citado pela IA precisa existir nos dados; senão usa a padrão)
 *   → Um envio por destinatário → Enviar WhatsApp
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CRED_TELEGRAM } from "./lib/pecas.mjs";
import { JS_FORMATAR } from "./build-telegram-workflows.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRED_B2C = { httpHeaderAuth: { id: "CONFIGURAR_B2C_FINANCE_API", name: "B2C Finance API" } };
const CRED_WA = { httpHeaderAuth: { id: "CONFIGURAR_WHATSAPP_API", name: "WhatsApp API" } };
const CRED_IA = { openAiApi: { id: "CONFIGURAR_OPENAI", name: "OpenAI" } };
const TZ_PADRAO = "America/Bahia";

const nota = (nome, conteudo, pos, largura, altura, cor) => ({
  parameters: { content: conteudo, height: altura, width: largura, color: cor },
  name: nome,
  type: "n8n-nodes-base.stickyNote",
  typeVersion: 1,
  position: pos,
});
const code = (nome, js, pos, notaNo, extra = {}) => ({
  parameters: { jsCode: js },
  name: nome,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: pos,
  notes: notaNo,
  notesInFlow: true,
  ...extra,
});
const getApi = (nome, caminhoExpr, pos, notaNo) => ({
  parameters: {
    url: `={{ $env.B2C_FINANCE_API_URL }}${caminhoExpr}`,
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "X-B2C-Source", value: "n8n" },
        { name: "x-request-id", value: "={{ 'n8n-' + $execution.id }}" },
      ],
    },
    options: {},
  },
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  credentials: CRED_B2C,
  // Falha numa chamada não derruba o relatório: a consolidação diz
  // "não consegui consultar X" em vez de mostrar zero.
  onError: "continueRegularOutput",
  alwaysOutputData: true,
  notes: notaNo,
  notesInFlow: true,
});

// ---------------------------------------------------------------------------
// Código compartilhado
// ---------------------------------------------------------------------------

const JS_PREPARAR = (periodo) => `// Data de HOJE no fuso do negócio e destinatários (configuração por variável).
// B2C_REPORT_TIMEZONE (padrão ${TZ_PADRAO}) — o mesmo fuso que a API usa.
// B2C_REPORT_RECIPIENTS — números E.164 sem +, separados por vírgula.
const tz = $env.B2C_REPORT_TIMEZONE || '${TZ_PADRAO}';
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const destinatarios = String($env.B2C_REPORT_RECIPIENTS || '').split(',').map((s) => s.replace(/\\D/g, '')).filter(Boolean);
if (destinatarios.length === 0) throw new Error('B2C_REPORT_RECIPIENTS vazio — defina quem recebe o relatório (ver ENV.example).');
return [{ json: { periodo: '${periodo}', tz, hoje, competencia: hoje.slice(0, 7), destinatarios } }];`;

// Helpers usados dentro do nó "Consolidar dados" (string JS).
const JS_HELPERS = `const BRL = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0)).replace(/\\u00a0/g, ' ');
const DATA = (d) => (d ? d.split('-').reverse().join('/') : '');
const resposta = (nome) => {
  const j = $(nome).first().json || {};
  if (j.success === true) return { ok: true, data: j.data || {}, omitidas: (j.meta && j.meta.omittedSections) || [] };
  return { ok: false, data: {}, omitidas: [], erro: (j.error && (j.error.code || j.error.message)) || 'sem resposta' };
};
const valores = new Set(); // todo R$ que a mensagem pode citar
const rs = (v) => { const t = BRL(v); valores.add(t.replace('R$ ', '')); return t; };
const curto = (t, n = 60) => { const s = String(t || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const lista = (itens, fmt, max = 5) => {
  const linhas = itens.slice(0, max).map((x) => '• ' + fmt(x));
  if (itens.length > max) linhas.push('• … e mais ' + (itens.length - max));
  return linhas.join('\\n');
};`;

const JS_VALIDAR = `// Aceita o texto da IA só se TODO valor em R$ que ela citou existir nos
// dados consolidados. Qualquer valor desconhecido, texto vazio ou erro da IA →
// usa a MENSAGEM PADRÃO (montada só com dados da API). A IA organiza; não cria.
const base = $('Consolidar dados').first().json;
const ia = String(($json && ($json.text || $json.output)) || '').trim();
const normal = (s) => s.replace(/\\u00a0/g, ' ');
const citados = [...normal(ia).matchAll(/R\\$\\s?(-?[\\d.]+,\\d{2})/g)].map((m) => m[1]);
const desconhecidos = citados.filter((v) => !base.valoresPermitidos.includes(v));
let mensagem = base.mensagemPadrao;
let origem = 'padrao';
let motivo = 'ia_sem_texto';
if (ia && desconhecidos.length === 0 && ia.length <= 3900) {
  mensagem = ia;
  origem = 'ia';
  motivo = null;
} else if (ia && desconhecidos.length) {
  motivo = 'valores_nao_encontrados_nos_dados: ' + desconhecidos.join(', ');
} else if (ia) {
  motivo = 'texto_longo_demais';
}
return [{ json: { mensagem, origem, motivo, destinatarios: base.destinatarios } }];`;

const JS_ENVIO = `// Um item por destinatário. WHATSAPP_REPORT_MODE:
//  · "text" (padrão): mensagem livre — a Meta só entrega se o destinatário
//    falou com o número nas últimas 24 h (janela de atendimento);
//  · "template": modelo APROVADO na Meta (WHATSAPP_REPORT_TEMPLATE, idioma
//    WHATSAPP_REPORT_TEMPLATE_LANG) com UMA variável {{1}} no corpo — a
//    Meta não aceita quebra de linha em variável, então o texto vira uma linha.
const m = $json;
const modo = String($env.WHATSAPP_REPORT_MODE || 'text').toLowerCase();
return m.destinatarios.map((to) => {
  let payload;
  if (modo === 'template') {
    const linha = m.mensagem.replace(/[*_~]/g, '').replace(/\\s*\\n+\\s*/g, ' | ').replace(/\\s{2,}/g, ' ').slice(0, 1000);
    payload = {
      messaging_product: 'whatsapp', to, type: 'template',
      template: {
        name: $env.WHATSAPP_REPORT_TEMPLATE,
        language: { code: $env.WHATSAPP_REPORT_TEMPLATE_LANG || 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: linha }] }],
      },
    };
  } else {
    payload = { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: m.mensagem } };
  }
  return { json: { to, origem: m.origem, payload } };
});`;

const PROMPT_IA = (tipo, secoes, canal = "WhatsApp") => `Você recebe os dados do ${tipo} do B2C Finance, já consolidados e formatados, e uma MENSAGEM PADRÃO pronta. Reescreva a mensagem para o ${canal} de forma clara e organizada.

REGRAS (obrigatórias):
1. Use SOMENTE os dados fornecidos. Não invente números, clientes, datas, causas nem tendências.
2. Copie os valores em R$ EXATAMENTE como aparecem (ex.: R$ 1.500,00). Não some, não arredonde, não calcule nada novo.
3. Seções, nesta ordem, SÓ quando houver dado: ${secoes}. Sem dado → omita a seção (não escreva "nenhum" nem "zero", a menos que o dado diga isso).
4. NÃO faça recomendações próprias. "Prioridades" só pode repetir as ações que vieram nos dados; se não vieram, não crie.
5. Se algo "não pôde ser consultado" ou está "sem acesso", diga isso numa linha no fim — nunca trate como zero.
6. Formato ${canal}: curto, *negrito* só nos títulos das seções, listas com "•", no máximo 5 itens por lista, sem tabelas, sem markdown de links.
7. Responda APENAS com a mensagem final, em português.`;

const chain = (pos, tipo, secoes, canal = "WhatsApp") => ({
  parameters: {
    promptType: "define",
    text: "=DADOS (JSON):\n{{ JSON.stringify($json.dados) }}\n\nMENSAGEM PADRÃO (fonte da verdade):\n{{ $json.mensagemPadrao }}",
    messages: { messageValues: [{ type: "SystemMessagePromptTemplate", message: PROMPT_IA(tipo, secoes, canal) }] },
  },
  name: "IA organiza a mensagem",
  type: "@n8n/n8n-nodes-langchain.chainLlm",
  typeVersion: 1.5,
  position: pos,
  onError: "continueRegularOutput",
  alwaysOutputData: true,
  notes: "Reescreve a mensagem padrão; não cria dados. Falhou → segue a padrão.",
  notesInFlow: true,
});
const modelo = (pos) => ({
  parameters: { model: { __rl: true, value: "gpt-4o-mini", mode: "list", cachedResultName: "gpt-4o-mini" }, options: { temperature: 0 } },
  name: "Modelo de IA",
  type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  typeVersion: 1.2,
  position: pos,
  credentials: CRED_IA,
  notes: "Temperatura 0: organizar, não criar.",
  notesInFlow: true,
});
const enviar = (pos) => ({
  parameters: {
    method: "POST",
    url: "={{ $env.WHATSAPP_API_URL }}/{{ $env.WHATSAPP_PHONE_NUMBER_ID }}/messages",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json.payload) }}",
    options: {},
  },
  name: "Enviar WhatsApp",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  credentials: CRED_WA,
  notes: "WhatsApp Cloud API (texto ou modelo aprovado).",
  notesInFlow: true,
});
const agendamento = (nome, envVar, padrao, pos) => ({
  parameters: {
    rule: { interval: [{ field: "cronExpression", expression: `={{ $env.${envVar} || '${padrao}' }}` }] },
  },
  name: nome,
  type: "n8n-nodes-base.scheduleTrigger",
  typeVersion: 1.2,
  position: pos,
  notes: `Cron em ${envVar} (padrão ${padrao}), no fuso do workflow.`,
  notesInFlow: true,
});

function workflow({ nome, arquivo, periodo, agenda, gets, consolidar, tipo, secoes, notas }) {
  const nosGet = gets.map((g, i) => getApi(g.nome, g.caminho, [440 + i * 220, 300], g.nota));
  const cadeia = ["Preparar data e destinatários", ...gets.map((g) => g.nome), "Consolidar dados", "IA organiza a mensagem", "Validar mensagem", "Um envio por destinatário", "Enviar WhatsApp"];
  const xConsolidar = 440 + gets.length * 220;
  const nodes = [
    ...notas.map((n, i) => nota(`Nota: ${n.titulo}`, n.texto, n.pos, n.w, n.h, n.cor ?? [7, 5, 6, 3][i % 4])),
    agendamento(agenda.nome, agenda.env, agenda.padrao, [0, 300]),
    {
      parameters: {},
      name: "Executar agora (teste)",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 480],
      notes: "Roda o relatório na hora, sem esperar o horário (teste).",
      notesInFlow: true,
    },
    code("Preparar data e destinatários", JS_PREPARAR(periodo), [220, 300], "Hoje (fuso configurável) e quem recebe."),
    ...nosGet,
    code("Consolidar dados", consolidar, [xConsolidar, 300], "Só dados da API; monta a mensagem padrão."),
    chain([xConsolidar + 220, 300], tipo, secoes),
    modelo([xConsolidar + 220, 500]),
    code("Validar mensagem", JS_VALIDAR, [xConsolidar + 460, 300], "R$ desconhecido ou falha da IA → mensagem padrão."),
    code("Um envio por destinatário", JS_ENVIO, [xConsolidar + 680, 300], "Texto ou modelo aprovado (WHATSAPP_REPORT_MODE)."),
    enviar([xConsolidar + 900, 300]),
  ];
  const connections = {
    [agenda.nome]: { main: [[{ node: cadeia[0], type: "main", index: 0 }]] },
    "Executar agora (teste)": { main: [[{ node: cadeia[0], type: "main", index: 0 }]] },
    ...Object.fromEntries(cadeia.slice(0, -1).map((n, i) => [n, { main: [[{ node: cadeia[i + 1], type: "main", index: 0 }]] }])),
    "Modelo de IA": { ai_languageModel: [[{ node: "IA organiza a mensagem", type: "ai_languageModel", index: 0 }]] },
  };
  const wf = {
    name: nome,
    nodes,
    connections,
    settings: {
      executionOrder: "v1",
      // Fuso do AGENDAMENTO. Mude aqui (Workflow → Settings → Timezone) se o
      // negócio não estiver no fuso da Bahia; a data do relatório segue
      // B2C_REPORT_TIMEZONE.
      timezone: TZ_PADRAO,
      saveDataSuccessExecution: "none",
      saveDataErrorExecution: "all",
      saveManualExecutions: true,
    },
    pinData: {},
    active: false,
    meta: {
      b2c: {
        workflow: arquivo.replace(".json", ""),
        version: 1,
        apiVersion: "v1",
        readOnly: true,
        requiredScopes: ["reports.read", "routine.read", "dashboard.read", "receivables.read", "expenses.read", "clients.read", "upsells.read"],
        generatedBy: "integrations/n8n/scripts/build-report-workflows.mjs",
      },
    },
    tags: [],
  };
  writeFileSync(join(RAIZ, "workflows", arquivo), JSON.stringify(wf, null, 2) + "\n");
}

const NOTA_CONFIG = (envCron, padrao) => `### Configuração\n- **Horário:** \`${envCron}\` (cron, padrão \`${padrao}\`).\n- **Fuso do agendamento:** Workflow Settings → Timezone (\`${TZ_PADRAO}\`).\n- **Data do relatório:** \`B2C_REPORT_TIMEZONE\` (padrão \`${TZ_PADRAO}\`, o fuso da API).\n- **Quem recebe:** \`B2C_REPORT_RECIPIENTS\`.\n- **Envio:** \`WHATSAPP_REPORT_MODE\` = text | template.`;
const NOTA_REGRAS = `### Sem dado inventado\nA consolidação monta a **mensagem padrão** só com o que a API trouxe (seção sem dado some; falha de consulta aparece como "não consegui consultar", nunca zero).\nA IA só **reorganiza**. Se citar um R$ que não está nos dados — ou falhar — vai a mensagem padrão. Sem dados de ações, não há "prioridades".`;
const NOTA_ENVIO = `### WhatsApp\nMensagem livre (\`text\`) só é entregue dentro da janela de 24 h da Meta. Para envio diário garantido, use um **modelo aprovado** (\`template\`, com uma variável {{1}}).`;

// ---------------------------------------------------------------------------
// MANHÃ
// ---------------------------------------------------------------------------

const CONSOLIDAR_MANHA = `// Junta relatório do dia + rotina + indicadores do mês e monta a MENSAGEM
// PADRÃO — só com o que a API trouxe. Seção sem dado não aparece.
${JS_HELPERS}
const prep = $('Preparar data e destinatários').first().json;
const rel = resposta('API: relatório do dia');
const rot = resposta('API: rotina do dia');
const dash = resposta('API: indicadores do mês');
const semAcesso = [...rel.omitidas];
const falhas = [];
if (!rel.ok) falhas.push('relatório do dia');
if (!rot.ok) falhas.push('rotina');
if (!dash.ok) falhas.push('indicadores');

const secoes = [];
const dados = { data: prep.hoje };

// Recebimentos previstos hoje (em aberto)
const due = rel.data.receivables && rel.data.receivables.dueToday;
if (due) {
  const abertos = (due.items || []).filter((b) => b.openAmount > 0);
  if (abertos.length) {
    dados.recebimentosPrevistosHoje = { quantidade: abertos.length, valor: rs(due.openAmount) };
    secoes.push('*Recebimentos previstos hoje* — ' + abertos.length + ' · ' + rs(due.openAmount) + '\\n' + lista(abertos, (b) => curto(b.client.name) + ' — ' + rs(b.openAmount)));
  }
}
// Recebido (hoje até agora + no mês)
const rec = rel.data.receivables && rel.data.receivables.received;
const recMes = dash.data.metrics && dash.data.metrics.recebido_competencia;
if ((rec && rec.count > 0) || (recMes && recMes.value)) {
  const partes = [];
  if (rec && rec.count > 0) partes.push('hoje: ' + rs(rec.amount) + ' (' + rec.count + ')');
  if (recMes && recMes.value) partes.push('no mês: ' + rs(recMes.value));
  dados.recebido = partes;
  secoes.push('*Recebido* — ' + partes.join(' · '));
}
// Vencidos (cobranças)
const col = rot.data.collections;
if (col && col.overdue && col.overdue.length) {
  dados.vencidos = { clientes: col.overdue.length, valor: rs(col.overdueTotal) };
  secoes.push('*Vencidos* — ' + col.overdue.length + ' cliente(s) · ' + rs(col.overdueTotal) + '\\n' + lista(col.overdue, (q) => curto(q.client.name) + ' — ' + rs(q.totalOverdue) + ' (' + q.daysOverdue + 'd)'));
}
// Despesas vencendo (vencidas + próximos dias)
const pag = rot.data.payments;
if (pag && ((pag.overdue && pag.overdue.length) || (pag.dueSoon && pag.dueSoon.length))) {
  const itens = [...(pag.overdue || []).map((p) => ({ ...p, _v: true })), ...(pag.dueSoon || [])];
  const partes = [];
  if (pag.overdueTotal > 0) partes.push('vencidas ' + rs(pag.overdueTotal));
  if (pag.dueSoonTotal > 0) partes.push('próximos dias ' + rs(pag.dueSoonTotal));
  dados.despesasVencendo = partes;
  secoes.push('*Despesas vencendo* — ' + partes.join(' · ') + '\\n' + lista(itens, (p) => curto(p.description) + ' — ' + rs(p.amount) + (p._v ? ' (vencida)' : p.dueDate ? ' (' + DATA(p.dueDate) + ')' : '')));
}
// MRR atual
const m = dash.data.metrics || {};
if (m.mrr_oficial && m.mrr_oficial.value != null) {
  dados.mrr = rs(m.mrr_oficial.value);
  secoes.push('*MRR atual* — ' + rs(m.mrr_oficial.value) + (m.clientes_ativos && m.clientes_ativos.value != null ? ' · ' + m.clientes_ativos.value + ' clientes ativos' : ''));
}
// Renovações pendentes do mês
const ren = rot.data.renewals;
if (ren && ren.pendingCount > 0) {
  dados.renovacoes = { pendentes: ren.pendingCount, valorEsperado: rs(ren.pendingExpectedValue) };
  secoes.push('*Renovações do mês* — ' + ren.pendingCount + ' pendente(s) · ' + rs(ren.pendingExpectedValue) + ' esperado');
}
// Churn do mês
if (m.churn_quantidade && m.churn_quantidade.value) {
  dados.churn = { clientes: m.churn_quantidade.value, valor: m.churn_valor && m.churn_valor.value != null ? rs(m.churn_valor.value) : null };
  secoes.push('*Churn do mês* — ' + m.churn_quantidade.value + ' cliente(s)' + (dados.churn.valor ? ' · ' + dados.churn.valor : ''));
}
// Prioridades: SÓ as ações que a rotina trouxe (nada criado aqui)
const acoes = (rot.data.actions || []).filter((a) => !a.done);
if (acoes.length) {
  dados.prioridades = acoes.map((a) => a.text);
  secoes.push('*Prioridades de hoje*\\n' + lista(acoes, (a) => a.text));
  for (const a of acoes) for (const v of a.text.matchAll(/R\\$\\s?([\\d.]+,\\d{2})/g)) valores.add(v[1]);
}

const rodape = [];
if (falhas.length) rodape.push('Não consegui consultar: ' + falhas.join(', ') + '.');
if (semAcesso.length) rodape.push('Sem acesso a: ' + semAcesso.join(', ') + '.');
const cabecalho = '*Bom dia! Resumo do B2C Finance — ' + DATA(prep.hoje) + '*';
const corpo = secoes.length ? secoes.join('\\n\\n') : 'Nada previsto nem pendente registrado para hoje.';
const mensagemPadrao = [cabecalho, corpo, rodape.join(' ')].filter(Boolean).join('\\n\\n');
dados.naoConsultado = falhas;
dados.semAcesso = semAcesso;
return [{ json: { dados, mensagemPadrao, valoresPermitidos: [...valores], destinatarios: prep.destinatarios } }];`;

workflow({
  nome: "B2C Finance · Relatório da manhã (WhatsApp)",
  arquivo: "daily-morning-report.json",
  periodo: "manha",
  agenda: { nome: "Agendamento (manhã)", env: "B2C_MORNING_REPORT_CRON", padrao: "0 7 * * 1-6" },
  gets: [
    { nome: "API: relatório do dia", caminho: "/reports/daily?date={{ $('Preparar data e destinatários').first().json.hoje }}", nota: "GET /reports/daily (reports.read)" },
    { nome: "API: rotina do dia", caminho: "/routine/daily", nota: "GET /routine/daily (routine.read)" },
    { nome: "API: indicadores do mês", caminho: "/dashboard/summary?competence={{ $('Preparar data e destinatários').first().json.competencia }}", nota: "GET /dashboard/summary (dashboard.read)" },
  ],
  consolidar: CONSOLIDAR_MANHA,
  tipo: "INÍCIO DO DIA",
  secoes: "Recebimentos previstos hoje; Recebido; Vencidos; Despesas vencendo; MRR atual; Renovações do mês; Churn do mês; Prioridades de hoje",
  notas: [
    { titulo: "sobre", texto: "## Relatório da manhã (somente leitura)\nCron → API B2C (relatório do dia, rotina, indicadores) → IA organiza → WhatsApp.\nNunca acessa banco/Supabase/Prisma — só a API. Tokens só nas credenciais.\n**Chega desativado.** Ative depois do teste (docs/N8N_DAILY_REPORTS.md).", pos: [-480, 40], w: 440, h: 300 },
    { titulo: "configuração", texto: NOTA_CONFIG("B2C_MORNING_REPORT_CRON", "0 7 * * 1-6"), pos: [-480, 360], w: 440, h: 300 },
    { titulo: "sem dado inventado", texto: NOTA_REGRAS, pos: [1100, 40], w: 700, h: 220 },
    { titulo: "WhatsApp", texto: NOTA_ENVIO, pos: [1820, 40], w: 440, h: 220 },
  ],
});

// ---------------------------------------------------------------------------
// NOITE
// ---------------------------------------------------------------------------

const consolidarNoite = (extraNoite = "") => `// Fechamento do dia: o que foi feito e o que ficou pendente. MENSAGEM
// PADRÃO só com o que a API trouxe; seção sem dado não aparece.
${JS_HELPERS}
const prep = $('Preparar data e destinatários').first().json;
const rel = resposta('API: dados do dia');
const rot = resposta('API: rotina do dia');
const semAcesso = [...rel.omitidas];
const falhas = [];
if (!rel.ok) falhas.push('dados do dia');
if (!rot.ok) falhas.push('rotina');

const secoes = [];
const dados = { data: prep.hoje };

// Ações executadas (checklist da rotina concluído hoje)
const feitas = (rot.data.actions || []).filter((a) => a.done);
if (feitas.length) {
  dados.acoesExecutadas = feitas.map((a) => a.text);
  secoes.push('*Ações executadas* — ' + feitas.length + '\\n' + lista(feitas, (a) => a.text));
  for (const a of feitas) for (const v of a.text.matchAll(/R\\$\\s?([\\d.]+,\\d{2})/g)) valores.add(v[1]);
}
// Recebimentos do dia
const rec = rel.data.receivables && rel.data.receivables.received;
if (rec && rec.count > 0) {
  dados.recebimentos = { quantidade: rec.count, valor: rs(rec.amount) };
  secoes.push('*Recebimentos* — ' + rec.count + ' · ' + rs(rec.amount) + '\\n' + lista(rec.items, (p) => curto(p.client.name) + ' — ' + rs(p.amount)));
}
// Despesas pagas no dia
const pagas = rel.data.expenses && rel.data.expenses.paid;
if (pagas && pagas.count > 0) {
  dados.despesasPagas = { quantidade: pagas.count, valor: rs(pagas.amount) };
  secoes.push('*Despesas pagas* — ' + pagas.count + ' · ' + rs(pagas.amount) + '\\n' + lista(pagas.items, (d) => curto(d.description) + ' — ' + rs(d.amount)));
}
// Clientes cadastrados
const cli = rel.data.clients || {};
const cadastrados = cli.createdClients || [];
if (cadastrados.length) {
  dados.clientesCadastrados = cadastrados.map((c) => c.name);
  secoes.push('*Clientes cadastrados* — ' + cadastrados.length + '\\n' + lista(cadastrados, (c) => curto(c.name) + (c.modality ? ' (' + c.modality + ')' : '')));
}
// Status alterados (registrados hoje). O PRIMEIRO registro de um cliente
// cadastrado hoje é o status inicial do cadastro — não é "alteração".
const novosIds = new Set(cadastrados.map((c) => c.id));
const jaViuInicial = new Set();
const mudancas = (cli.statusChangesRecorded || []).filter((m) => {
  if (!novosIds.has(m.client.id) || jaViuInicial.has(m.client.id)) return true;
  jaViuInicial.add(m.client.id);
  return false;
});
if (mudancas.length) {
  dados.statusAlterados = mudancas.map((m) => ({ cliente: m.client.name, status: m.status && m.status.label, aPartirDe: DATA(m.effectiveFrom) }));
  secoes.push('*Status alterados* — ' + mudancas.length + '\\n' + lista(mudancas, (m) => curto(m.client.name) + ' → ' + (m.status && m.status.label) + ' a partir de ' + DATA(m.effectiveFrom)));
}
// Upsells criados (e vendidos) hoje
const up = rel.data.upsells;
if (up && (up.created.count > 0 || up.won.count > 0)) {
  const partes = [];
  if (up.created.count > 0) partes.push(up.created.count + ' criado(s) · ' + rs(up.created.value));
  if (up.won.count > 0) partes.push(up.won.count + ' vendido(s) · ' + rs(up.won.value));
  dados.upsells = partes;
  secoes.push('*Upsells* — ' + partes.join(' · ') + '\\n' + lista(up.created.items, (u) => curto(u.client.name) + ' — ' + curto(u.title || 'oportunidade', 40) + ' — ' + rs(u.value)));
}
${extraNoite}// Pendências
const pend = [];
const naoFeitas = (rot.data.actions || []).filter((a) => !a.done);
for (const a of naoFeitas) pend.push(a.text);
const due = rel.data.receivables && rel.data.receivables.dueToday;
if (due && due.openAmount > 0) pend.push('Cobranças de hoje ainda em aberto: ' + rs(due.openAmount));
const col = rot.data.collections;
if (col && col.overdueTotal > 0) pend.push('Cobranças vencidas: ' + rs(col.overdueTotal) + ' (' + col.overdue.length + ' cliente(s))');
const pag = rot.data.payments;
if (pag && pag.overdueTotal > 0) pend.push('Pagamentos vencidos: ' + rs(pag.overdueTotal));
for (const a of naoFeitas) for (const v of a.text.matchAll(/R\\$\\s?([\\d.]+,\\d{2})/g)) valores.add(v[1]);
if (pend.length) {
  dados.pendencias = pend;
  secoes.push('*Pendências*\\n' + lista(pend, (t) => t, 6));
}

const rodape = [];
if (falhas.length) rodape.push('Não consegui consultar: ' + falhas.join(', ') + '.');
if (semAcesso.length) rodape.push('Sem acesso a: ' + semAcesso.join(', ') + '.');
const cabecalho = '*Fechamento do dia — ' + DATA(prep.hoje) + '*';
const corpo = secoes.length ? secoes.join('\\n\\n') : 'Nenhum movimento registrado hoje.';
const mensagemPadrao = [cabecalho, corpo, rodape.join(' ')].filter(Boolean).join('\\n\\n');
dados.naoConsultado = falhas;
dados.semAcesso = semAcesso;
return [{ json: { dados, mensagemPadrao, valoresPermitidos: [...valores], destinatarios: prep.destinatarios } }];`;

const CONSOLIDAR_NOITE = consolidarNoite();

workflow({
  nome: "B2C Finance · Relatório da noite (WhatsApp)",
  arquivo: "daily-evening-report.json",
  periodo: "noite",
  agenda: { nome: "Agendamento (noite)", env: "B2C_EVENING_REPORT_CRON", padrao: "0 19 * * 1-5" },
  gets: [
    { nome: "API: dados do dia", caminho: "/reports/daily?date={{ $('Preparar data e destinatários').first().json.hoje }}", nota: "GET /reports/daily (reports.read + áreas)" },
    { nome: "API: rotina do dia", caminho: "/routine/daily", nota: "GET /routine/daily (routine.read)" },
  ],
  consolidar: CONSOLIDAR_NOITE,
  tipo: "FECHAMENTO DO DIA",
  secoes: "Ações executadas; Recebimentos; Despesas pagas; Clientes cadastrados; Status alterados; Upsells; Pendências",
  notas: [
    { titulo: "sobre", texto: "## Relatório da noite (somente leitura)\nCron → API B2C (dados do dia, rotina) → IA organiza → WhatsApp.\nAções executadas, recebimentos, despesas pagas, clientes cadastrados, status alterados, upsells e pendências.\nNunca acessa banco/Supabase/Prisma. **Chega desativado.**", pos: [-480, 40], w: 440, h: 300 },
    { titulo: "configuração", texto: NOTA_CONFIG("B2C_EVENING_REPORT_CRON", "0 19 * * 1-5"), pos: [-480, 360], w: 440, h: 300 },
    { titulo: "sem dado inventado", texto: NOTA_REGRAS, pos: [880, 40], w: 700, h: 220 },
    { titulo: "WhatsApp", texto: NOTA_ENVIO, pos: [1600, 40], w: 440, h: 220 },
  ],
});

// ---------------------------------------------------------------------------
// TELEGRAM (Fase 16 · bloco 2) — telegram-daily-morning-report.json e
// telegram-daily-evening-report.json
//
// A MESMA consolidação e a mesma regra "IA organiza, não cria" dos relatórios
// do WhatsApp. O que muda:
//  · QUEM recebe vem da API (GET /integrations/recipients): só quem tem a
//    preferência LIGADA no vínculo — nunca todo vinculado, nunca variável;
//  · UM relatório por pessoa, montado com X-B2C-Identity = vínculo dela: a
//    API recorta pelo RBAC de cada um (quem não vê o caixa não recebe o caixa);
//  · "hoje" e o fuso vêm da API (fuso oficial da operação);
//  · saída em HTML seguro (mesmo formatador do agente do Telegram).
// ---------------------------------------------------------------------------

const TG = {
  destinatarios: "API: destinatários",
  itens: "Um item por destinatário",
  loop: "Um destinatário por vez",
  preparar: "Preparar data e destinatários",
  envio: "Preparar envio (Telegram)",
  formatar: "Formatar para o Telegram",
  enviar: "Telegram: enviar relatório",
};

const getApiDelegado = (nome, caminhoExpr, pos, notaNo) => ({
  ...getApi(nome, caminhoExpr, pos, notaNo),
  parameters: {
    ...getApi(nome, caminhoExpr, pos, notaNo).parameters,
    headerParameters: {
      parameters: [
        { name: "X-B2C-Source", value: "telegram" },
        { name: "x-request-id", value: "={{ 'n8n-' + $execution.id }}" },
        // O relatório é DA PESSOA: a API recorta pelo RBAC dela.
        // $node[…] (e não $('…')): dentro do loop, o n8n 1.123 não resolve
        // $('…').first() em parâmetro de nó HTTP ("could not be cloned") e o
        // cabeçalho sairia VAZIO — o relatório viria com os scopes da conta.
        { name: "X-B2C-Identity", value: `={{ $node['${TG.preparar}'].json.identityId }}` },
      ],
    },
    options: { response: { response: { neverError: true } } },
  },
});

const JS_ITENS = (finalidade) => `// Quem recebe = a API diz (preferência "${finalidade}" LIGADA no vínculo, em
// Configurações → Integrações → Canais → Envios). Ninguém marcado = nada enviado.
const r = $input.first().json || {};
if (r.success !== true || !r.data) {
  throw new Error('Não consegui consultar os destinatários na API B2C: ' + ((r.error && r.error.code) || 'sem resposta'));
}
const d = r.data;
return d.recipients.map((p) => ({
  json: { identityId: p.identityId, chatId: p.externalIdentifier, userName: p.userName, hoje: d.today, tz: d.timezone },
}));`;

const JS_PREPARAR_TG = (periodo) => `// Um destinatário por vez: data (da API, fuso oficial), vínculo e chat.
// Mesmo formato do "Preparar" dos relatórios do WhatsApp — a consolidação é a mesma.
const p = $input.first().json;
return [{ json: { periodo: '${periodo}', tz: p.tz, hoje: p.hoje, competencia: p.hoje.slice(0, 7), destinatarios: [String(p.chatId)], identityId: p.identityId, userName: p.userName } }];`;

const JS_ENVIO_TG = (gets) => `// Mensagem validada → item do formatador do Telegram (um chat privado).
// TRAVA: só entrega se TODA consulta que respondeu foi feita EM NOME desta
// pessoa (meta.onBehalfOf = vínculo dela). Senão o relatório pode ter sido
// montado com os scopes da integração inteira — vai só um aviso, sem dado.
const m = $json;
const prep = $('${TG.preparar}').first().json;
const consultas = ${JSON.stringify(gets.map((g) => g.nome))};
const semDelegacao = consultas.filter((n) => {
  const j = $(n).first().json || {};
  return j.success === true && !(j.meta && j.meta.onBehalfOf && j.meta.onBehalfOf.identityId === prep.identityId);
});
if (semDelegacao.length) {
  return [{ json: { chatId: prep.destinatarios[0], texto: 'Não consegui montar o seu relatório com segurança agora. A tentativa foi registrada.', origem: 'bloqueado', semDelegacao } }];
}
return [{ json: { chatId: m.destinatarios[0], texto: m.mensagem, origem: m.origem } }];`;

// Seção extra da NOITE no Telegram: ações do agente (as do próprio destinatário) hoje.
const EXTRA_NOITE_TG = `// Ações do agente hoje (as desta pessoa, pelo Telegram/WhatsApp, executadas após a confirmação dela)
const ag = resposta('API: ações do agente');
if (ag.ok && Array.isArray(ag.data)) {
  const diaLocal = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: prep.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const feitasAg = ag.data.filter((a) => a.status === 'EXECUTED' && a.executedAt && diaLocal(a.executedAt) === prep.hoje);
  if (feitasAg.length) {
    dados.acoesDoAgente = feitasAg.map((a) => ({ acao: a.tool, sobre: a.summary && a.summary.label }));
    secoes.push('*Ações pelo agente* — ' + feitasAg.length + '\\n' + lista(feitasAg, (a) => (a.summary && a.summary.label ? curto(a.summary.label) + ' — ' : '') + String(a.tool || a.operation).replace(/_/g, ' ') + (a.summary && a.summary.amount != null ? ' — ' + rs(a.summary.amount) : '')));
  }
}
`;

function workflowTelegram({ nome, arquivo, periodo, finalidade, agenda, gets, consolidar, tipo, secoes, notas }) {
  const nosGet = gets.map((g, i) => getApiDelegado(g.nome, g.caminho, [1100 + i * 220, 300], g.nota));
  const xC = 1100 + gets.length * 220;
  const cadeia = [TG.preparar, ...gets.map((g) => g.nome), "Consolidar dados", "IA organiza a mensagem", "Validar mensagem", TG.envio, TG.formatar, TG.enviar];
  const nodes = [
    ...notas.map((n, i) => nota(`Nota: ${n.titulo}`, n.texto, n.pos, n.w, n.h, n.cor ?? [7, 5, 6, 3][i % 4])),
    agendamento(agenda.nome, agenda.env, agenda.padrao, [0, 300]),
    {
      parameters: {},
      name: "Executar agora (teste)",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 480],
      notes: "Roda o relatório na hora, sem esperar o horário (teste).",
      notesInFlow: true,
    },
    {
      parameters: {
        url: `={{ $env.B2C_FINANCE_API_URL }}/integrations/recipients?channel=TELEGRAM&purpose=${finalidade}`,
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "X-B2C-Source", value: "telegram" },
            { name: "x-request-id", value: "={{ 'n8n-' + $execution.id }}" },
          ],
        },
        options: { response: { response: { neverError: true } } },
      },
      name: TG.destinatarios,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [220, 300],
      credentials: CRED_B2C,
      notes: `GET /integrations/recipients (purpose=${finalidade}) · identities.resolve`,
      notesInFlow: true,
    },
    code(TG.itens, JS_ITENS(finalidade), [440, 300], "Só quem marcou este relatório (preferência no vínculo)."),
    {
      parameters: { batchSize: 1, options: {} },
      name: TG.loop,
      type: "n8n-nodes-base.splitInBatches",
      typeVersion: 3,
      position: [660, 300],
      notes: "Um relatório por pessoa, com o RBAC dela.",
      notesInFlow: true,
    },
    code(TG.preparar, JS_PREPARAR_TG(periodo), [880, 300], "Data (API), vínculo e chat desta pessoa."),
    ...nosGet,
    code("Consolidar dados", consolidar, [xC, 300], "Só dados da API; monta a mensagem padrão."),
    chain([xC + 220, 300], tipo, secoes, "Telegram"),
    modelo([xC + 220, 500]),
    code("Validar mensagem", JS_VALIDAR, [xC + 460, 300], "R$ desconhecido ou falha da IA → mensagem padrão."),
    code(TG.envio, JS_ENVIO_TG(gets), [xC + 680, 300], "Só entrega se a API respondeu em nome desta pessoa."),
    code(TG.formatar, JS_FORMATAR, [xC + 900, 300], "HTML seguro + partes (limite do Telegram)."),
    {
      parameters: {
        resource: "message",
        operation: "sendMessage",
        chatId: "={{ $json.chatId }}",
        text: "={{ $json.text }}",
        additionalFields: { appendAttribution: false, parse_mode: "HTML", disable_web_page_preview: true },
      },
      name: TG.enviar,
      type: "n8n-nodes-base.telegram",
      typeVersion: 1.2,
      position: [xC + 1120, 300],
      credentials: CRED_TELEGRAM,
      // Falha no envio para uma pessoa (bloqueou o bot) não derruba os outros.
      onError: "continueRegularOutput",
      notes: "sendMessage em HTML. Falhou para um → segue para o próximo.",
      notesInFlow: true,
    },
  ];
  const liga = (de, para, saida = 0) => [de, saida, para];
  const ligacoes = [
    liga(agenda.nome, TG.destinatarios),
    liga("Executar agora (teste)", TG.destinatarios),
    liga(TG.destinatarios, TG.itens),
    liga(TG.itens, TG.loop),
    liga(TG.loop, TG.preparar, 1),
    ...cadeia.slice(0, -1).map((n, i) => liga(n, cadeia[i + 1])),
    liga(TG.enviar, TG.loop),
  ];
  const connections = {};
  for (const [de, saida, para] of ligacoes) {
    const c = (connections[de] ??= { main: [] });
    while (c.main.length <= saida) c.main.push([]);
    c.main[saida].push({ node: para, type: "main", index: 0 });
  }
  connections["Modelo de IA"] = { ai_languageModel: [[{ node: "IA organiza a mensagem", type: "ai_languageModel", index: 0 }]] };
  const wf = {
    name: nome,
    nodes,
    connections,
    settings: {
      executionOrder: "v1",
      // Fuso do AGENDAMENTO (o cron). A DATA do relatório vem da API (today/timezone).
      timezone: TZ_PADRAO,
      saveDataSuccessExecution: "none",
      saveDataErrorExecution: "all",
      saveManualExecutions: true,
    },
    pinData: {},
    active: false,
    meta: {
      b2c: {
        workflow: arquivo.replace(".json", ""),
        channel: "TELEGRAM",
        version: 1,
        apiVersion: "v1",
        readOnly: true,
        recipients: `GET /integrations/recipients?channel=TELEGRAM&purpose=${finalidade}`,
        requiredScopes: ["identities.resolve", "reports.read", "routine.read", "dashboard.read", "receivables.read", "expenses.read", "clients.read", "upsells.read", ...(periodo === "noite" ? ["agent_actions.manage"] : [])].sort(),
        generatedBy: "integrations/n8n/scripts/build-report-workflows.mjs",
      },
    },
    tags: [],
  };
  writeFileSync(join(RAIZ, "workflows", arquivo), JSON.stringify(wf, null, 2) + "\n");
}

const NOTA_CONFIG_TG = (envCron, padrao, finalidade) => `### Configuração\n- **Horário:** \`${envCron}\` (cron, padrão \`${padrao}\`), no fuso do workflow (Settings → Timezone, \`${TZ_PADRAO}\`).\n- **Data do relatório:** a da API (\`today\`, fuso oficial da operação).\n- **Quem recebe:** Configurações → Integrações → Canais → **Envios** (\`${finalidade}\`). Ninguém marcado = nada enviado.\n- **Conteúdo:** o de cada pessoa, com as permissões dela (X-B2C-Identity).`;
const NOTA_TG = `### Telegram\nChat privado de cada pessoa (Telegram User ID). Bot token só na credencial "Telegram Bot". Envio que falhar para uma pessoa (ex.: bloqueou o bot) não impede os outros.`;

const DESTINO_TG = (finalidade) => [
  { titulo: "sem dado inventado", texto: NOTA_REGRAS, pos: [1300, 40], w: 700, h: 220 },
  { titulo: "Telegram", texto: NOTA_TG, pos: [2020, 40], w: 440, h: 220 },
];

workflowTelegram({
  nome: "B2C Finance · Telegram · Relatório da manhã",
  arquivo: "telegram-daily-morning-report.json",
  periodo: "manha",
  finalidade: "morning_report",
  agenda: { nome: "Agendamento (manhã)", env: "TELEGRAM_MORNING_REPORT_CRON", padrao: "0 7 * * 1-6" },
  gets: [
    { nome: "API: relatório do dia", caminho: "/reports/daily?date={{ $node['Preparar data e destinatários'].json.hoje }}", nota: "GET /reports/daily (reports.read) — RBAC da pessoa" },
    { nome: "API: rotina do dia", caminho: "/routine/daily", nota: "GET /routine/daily (routine.read) — RBAC da pessoa" },
    { nome: "API: indicadores do mês", caminho: "/dashboard/summary?competence={{ $node['Preparar data e destinatários'].json.competencia }}", nota: "GET /dashboard/summary (dashboard.read) — RBAC da pessoa" },
  ],
  consolidar: CONSOLIDAR_MANHA,
  tipo: "INÍCIO DO DIA",
  secoes: "Recebimentos previstos hoje; Recebido; Vencidos; Despesas vencendo; MRR atual; Renovações do mês; Churn do mês; Prioridades de hoje",
  notas: [
    { titulo: "sobre", texto: "## Relatório da manhã · Telegram (somente leitura)\nCron → API (quem recebe) → para cada pessoa: API B2C com o RBAC dela → IA organiza → Telegram.\nNunca acessa banco/Supabase/Prisma — só a API. Tokens só nas credenciais.\n**Chega desativado.** Ative depois do teste (docs/TELEGRAM.md).", pos: [-480, 40], w: 440, h: 300 },
    { titulo: "configuração", texto: NOTA_CONFIG_TG("TELEGRAM_MORNING_REPORT_CRON", "0 7 * * 1-6", "morning_report"), pos: [-480, 360], w: 440, h: 320 },
    ...DESTINO_TG("morning_report"),
  ],
});

workflowTelegram({
  nome: "B2C Finance · Telegram · Relatório da noite",
  arquivo: "telegram-daily-evening-report.json",
  periodo: "noite",
  finalidade: "evening_report",
  agenda: { nome: "Agendamento (noite)", env: "TELEGRAM_EVENING_REPORT_CRON", padrao: "0 19 * * 1-5" },
  gets: [
    { nome: "API: dados do dia", caminho: "/reports/daily?date={{ $node['Preparar data e destinatários'].json.hoje }}", nota: "GET /reports/daily (reports.read + áreas) — RBAC da pessoa" },
    { nome: "API: rotina do dia", caminho: "/routine/daily", nota: "GET /routine/daily (routine.read) — RBAC da pessoa" },
    { nome: "API: ações do agente", caminho: "/agent/pending-actions?limit=20", nota: "GET /agent/pending-actions (agent_actions.manage) — as da pessoa" },
  ],
  consolidar: consolidarNoite(EXTRA_NOITE_TG),
  tipo: "FECHAMENTO DO DIA",
  secoes: "Ações executadas; Recebimentos; Despesas pagas; Clientes cadastrados; Status alterados; Upsells; Ações pelo agente; Pendências",
  notas: [
    { titulo: "sobre", texto: "## Relatório da noite · Telegram (somente leitura)\nCron → API (quem recebe) → para cada pessoa: dados do dia, rotina e ações do agente com o RBAC dela → IA organiza → Telegram.\nRecebido, despesas pagas, cobranças, clientes cadastrados, status alterados, upsells, ações do agente e pendências.\nNunca acessa banco/Supabase/Prisma. **Chega desativado.**", pos: [-480, 40], w: 440, h: 320 },
    { titulo: "configuração", texto: NOTA_CONFIG_TG("TELEGRAM_EVENING_REPORT_CRON", "0 19 * * 1-5", "evening_report"), pos: [-480, 380], w: 440, h: 320 },
    ...DESTINO_TG("evening_report"),
  ],
});

console.log(
  "Relatórios gerados: daily-morning-report.json, daily-evening-report.json (WhatsApp); telegram-daily-morning-report.json, telegram-daily-evening-report.json (Telegram)"
);
