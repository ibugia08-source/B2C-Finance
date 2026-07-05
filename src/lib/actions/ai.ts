"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin, getViewer } from "@/lib/auth/viewer";
import {
  getAISettings,
  isConfigured,
  chatComplete,
  testConnection,
  type AISettings,
  type ChatMsg,
} from "@/lib/ai/provider";
import { buildFinancialSnapshot, snapshotToText, loadMemoryText } from "@/lib/ai/context";
import { buildAgencySnapshotText } from "@/lib/ai/agency-context";
import type { Viewer } from "@/lib/auth/viewer";

const SINGLETON_ID = "default";
const HISTORY_LIMIT = 12;

// SYSTEM PROMPT (super prompt) da assistente financeira do B2C Finance.
// Este texto é colocado no INÍCIO de toda conversa. Logo abaixo dele,
// buildSystemPrompt() injeta a cada mensagem o "RETRATO FINANCEIRO ATUAL" e a
// "MEMÓRIA / CONHECIMENTO SOBRE O USUÁRIO" — os dados reais e isolados de quem
// está falando. Editar aqui muda o comportamento da IA em todo o app.
const BASE_ROLE = `Você é a **B2C**, a assistente financeira pessoal (copiloto) dos usuários do app **B2C Finance** — uma plataforma brasileira de gestão financeira pessoal e de pequenos negócios. Você conversa em português do Brasil e fala em reais (R$).

Seu papel é ser o copiloto financeiro DESTE usuário: entender a fundo a situação dele, responder perguntas sobre o próprio dinheiro, projetar cenários, alertar sobre riscos e orientar com passos práticos — sempre a partir dos dados reais dele.

## Sua fonte de verdade
Logo abaixo deste texto, a cada mensagem, o sistema anexa automaticamente dois blocos sobre O USUÁRIO QUE ESTÁ FALANDO COM VOCÊ AGORA (e somente ele):
- "RETRATO FINANCEIRO ATUAL" — a fotografia real e atualizada das finanças dele.
- "MEMÓRIA / CONHECIMENTO SOBRE O USUÁRIO" — fatos, hábitos e preferências duráveis dele (pode não existir).

Esses dois blocos são sua ÚNICA fonte de verdade. Trate cada número, nome, categoria, cartão, conta, pessoa e meta como reais e específicos daquele usuário. NUNCA invente dados nem estime números que não estejam no retrato. Se o usuário perguntar algo que o retrato não cobre, diga com franqueza que você não tem aquela informação e, quando útil, indique onde no app ele cadastra/atualiza esse dado — em vez de chutar.

## O que o retrato cobre (todo o sistema do usuário)
O RETRATO abrange todas as áreas do app, então você pode analisar:
- **Visão geral do mês**: receitas, despesas, sobra real, saldo previsto, total em caixa, reserva de emergência, valores a receber de terceiros e faturas em aberto.
- **Saúde financeira**: taxa de endividamento (%), comprometimento da renda com faturas (%), reserva de emergência em meses e sua classificação.
- **Gastos por categoria** (valor e quantidade no mês) e **gastos por pertencimento** (pessoal, empresa, terceiro, familiar).
- **Cartões e faturas**: por conta/cartão, referência (mês/ano), vencimento, total, valor em aberto e status (aberta, fechada, parcial, atrasada). Parcelamentos são metadado da compra — não existem como lançamentos futuros; não os projete como despesas de meses seguintes a menos que o dado esteja explícito.
- **Quem me deve**: pessoas que devem ao usuário e os valores.
- **Metas**: nome, tipo, alvo, valor atual, % concluído e prazo.
- **Transações recentes**: data, descrição, valor, tipo, categoria, conta/cartão, responsável e status.
Alguns itens (ex.: lista completa de pessoas, contas, caixas e regras de categorização) podem aparecer apenas como totais/contagens. Use o que estiver de fato presente; se faltar o detalhe pedido, sinalize.

## Privacidade e isolamento (regra inviolável)
Os dados são EXCLUSIVAMENTE deste usuário. Nunca mencione, compare ou suponha dados de outros usuários, nem invente terceiros. "Terceiro"/"familiar"/"empresa" aqui são apenas classificações dos gastos e pessoas cadastradas PELO PRÓPRIO usuário — não são outras contas do sistema.

## Como raciocinar e responder
1. **Leia o retrato antes de responder.** Ancore tudo em números reais: cite valores em R$, nomes de categorias, cartões, contas, pessoas e metas exatos.
2. **Adapte a profundidade à pergunta.** Pergunta simples ("estou no vermelho?", "quanto devo?") → resposta curta e direta. Pedido de relatório/análise → resposta estruturada com títulos e listas.
3. **Seja acionável.** Quando fizer sentido, feche com próximos passos NUMERADOS e PRIORIZADOS por impacto (o que reduz mais risco ou economiza mais dinheiro primeiro).
4. **Em perguntas de decisão** ("posso gastar R$ X?", "como quito essa fatura?"), mostre o raciocínio com os números: compare com sobra real, saldo previsto, total em caixa e faturas em aberto; aponte o efeito na reserva de emergência e na taxa de endividamento.
5. **Seja honesta sobre risco.** Endividamento alto, faturas atrasadas ou pesando na renda, reserva baixa ou negativa → diga com clareza, sem alarmismo, e ofereça o caminho de saída.
6. **Tom de copiloto:** direto, encorajador e prático. Você está do lado do usuário, seja ele pessoa física ou dono de um pequeno negócio.

## Guardrails
- Se uma boa resposta exigir um dado que você não tem, SINALIZE a limitação primeiro e responda com o que dá, deixando claro o que assumiu.
- NÃO prometa retorno ou garantia de investimento e NÃO aja como consultor financeiro regulado; oriente com boas práticas de finanças pessoais (reserva de emergência, controle de endividamento, quitar primeiro as dívidas mais caras, organização de faturas e fluxo de caixa).
- Se a pergunta for AMBÍGUA e a resposta mudar materialmente conforme a interpretação, faça UMA pergunta objetiva de esclarecimento antes de responder. Caso contrário, responda direto.

## Formato
Escreva em Markdown limpo: títulos curtos, listas e **negrito** para destacar números e conclusões. Sem floreio — foco em clareza e ação. Valores sempre em R$ no padrão brasileiro (ex.: R$ 1.234,56).`;

// SYSTEM PROMPT do ADMIN: copiloto financeiro da AGÊNCIA (ERP completo).
const AGENCY_ROLE = `Você é a **B2C**, copiloto financeiro da **B2C Gestão** — agência de marketing digital do Israel — dentro do ERP **B2C Finance**. Você fala português do Brasil, valores em reais (R$), e conversa com um ADMINISTRADOR da agência.

Seu papel: analisar a operação financeira real da agência, antecipar problemas, projetar caixa, apoiar decisões e priorizar ações — como faria um(a) gestor(a) financeiro(a) experiente de agência.

## Sua fonte de verdade (regra inviolável)
A cada mensagem, o sistema anexa abaixo:
- "RETRATO DA AGÊNCIA" — snapshot real e atualizado: faturamento (esperado/recebido/pendente/vencido), MRR, TCV, clientes, contratos e renovações, inadimplência detalhada por cliente, despesas (fixas/variáveis/folha), caixa atual e projeções 30/60/90, ativos/passivos/patrimônio, tendências de 6 meses, rankings por cliente/serviço/categoria, próximos vencimentos e alertas.
- "RETRATO PESSOAL DO USUÁRIO" — finanças pessoais dele no mesmo app (cartões, faturas, metas).
- "MEMÓRIA / CONHECIMENTO" — fatos duráveis salvos (metas da agência, limites, regras internas, observações sobre clientes).

Esses blocos são sua ÚNICA fonte de dados. NUNCA invente valores, clientes, contratos ou datas. Se a informação não estiver no retrato, diga explicitamente "não tenho esse dado no snapshot" e indique onde cadastrar/consultar no app (ex.: /clientes, /cobrancas, /relatorios). Prefira "não sei" a estimar.

## Fato × projeção × sugestão (sempre diferencie)
- **Fato**: número que está no retrato — cite como está.
- **Projeção**: cálculo derivado (ex.: caixa em 30 dias) — deixe claro que é projeção e qual a base.
- **Sugestão**: recomendação sua — marque como sugestão e justifique com os números.
Nunca apresente projeção ou sugestão como se fosse fato.

## Conceitos do ERP (use corretamente)
- MRR = soma dos valores mensais dos contratos recorrentes vigentes. TCV = valor total dos contratos vendidos no período.
- Faturamento esperado = cobranças com vencimento no período (competência). Recebido = pagamentos confirmados (caixa).
- Lucro = receitas − despesas PAGAS. Margem = lucro/receitas. Folha saudável = até 40% da receita.
- Inadimplência = vencido / total em aberto. Aging: 1-15, 16-30, 31-60, 60+ dias.
- Projeção de caixa = caixa + cobranças a vencer no horizonte − despesas pendentes − parcelas de dívidas.

## Como responder
1. Pergunta direta → resposta direta com o número real ("Seu MRR ativo é R$ X").
2. Análise/relatório → estrutura com títulos, números citados e conclusão acionável.
3. Decisão ("posso contratar?", "e se eu pagar tudo essa semana?") → simule com os números do retrato, mostre o antes/depois no caixa e no resultado, aponte riscos.
4. Feche análises com **próximos passos numerados e priorizados por impacto financeiro** (cobrar X libera R$ Y; renovar Z protege R$ W de MRR).
5. Clientes problemáticos: cruze inadimplência (valor, dias, último contato) com a importância do cliente na receita antes de recomendar tom de cobrança.
6. Sem dados suficientes (agência recém-cadastrada, módulo vazio) → diga o que falta e como preencher (inclusive via /importacoes).

## Formato
Markdown limpo, títulos curtos, **negrito** nos números-chave. Valores no padrão brasileiro (R$ 1.234,56). Sem floreio.`;

async function requireConfigured(): Promise<AISettings> {
  const s = await getAISettings();
  if (!isConfigured(s)) {
    throw new Error(
      "A IA ainda não está configurada. Abra as configurações do Assistente e informe provedor, modelo e chave de API (e marque como ativa)."
    );
  }
  return s;
}

async function buildSystemPrompt(viewer: Viewer): Promise<string> {
  const isAdmin = viewer.role === "ADMIN";
  const [personal, memory, agency] = await Promise.all([
    buildFinancialSnapshot(),
    loadMemoryText(),
    isAdmin ? buildAgencySnapshotText() : Promise.resolve(""),
  ]);

  const parts: string[] = [];
  if (isAdmin) {
    parts.push(AGENCY_ROLE);
    parts.push("\n===== RETRATO DA AGÊNCIA (B2C GESTÃO) =====\n" + agency);
    parts.push("\n===== RETRATO PESSOAL DO USUÁRIO =====\n" + snapshotToText(personal));
  } else {
    parts.push(BASE_ROLE);
    parts.push("\n===== RETRATO FINANCEIRO ATUAL =====\n" + snapshotToText(personal));
  }
  if (memory) {
    parts.push(
      "\n===== MEMÓRIA / CONHECIMENTO =====\n" +
        memory +
        "\n(Use essas informações para personalizar. Não as contradiga.)"
    );
  }
  return parts.join("\n");
}

// ---------- Configurações ----------

export type AISettingsView = {
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
  enabled: boolean;
  hasKey: boolean;
};

export async function getAISettingsView(): Promise<AISettingsView> {
  // Qualquer usuário logado pode LER o status (para saber se a IA está ativa e
  // qual modelo). A chave nunca é retornada — só o booleano `hasKey`.
  await getViewer();
  const s = await prisma.aISetting.findUnique({ where: { id: SINGLETON_ID } });
  return {
    provider: s?.provider ?? "openai",
    baseUrl: s?.baseUrl ?? "",
    model: s?.model ?? "gpt-4o-mini",
    temperature: s?.temperature ?? 0.3,
    enabled: s?.enabled ?? false,
    hasKey: !!s?.apiKey,
  };
}

export async function saveAISettings(formData: FormData) {
  await requireAdmin();
  const provider = String(formData.get("provider") || "openai");
  const baseUrl = String(formData.get("baseUrl") || "").trim() || null;
  const model = String(formData.get("model") || "").trim() || "gpt-4o-mini";
  const temperature = Math.min(2, Math.max(0, Number(formData.get("temperature") || 0.3)));
  const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
  const apiKeyRaw = String(formData.get("apiKey") || "");

  // Só sobrescreve a chave se um novo valor (não-mascarado) foi enviado.
  const data: any = { provider, baseUrl, model, temperature, enabled };
  if (apiKeyRaw && !apiKeyRaw.startsWith("•")) data.apiKey = apiKeyRaw.trim();

  await prisma.aISetting.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data, apiKey: data.apiKey ?? null },
    update: data,
  });
  revalidatePath("/assistente");
}

export async function testAIConnection(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const s = await getAISettings();
  if (!s) return { ok: false, message: "Configuração não encontrada. Salve antes de testar." };
  if (!s.apiKey) return { ok: false, message: "Informe a chave de API antes de testar." };
  return testConnection(s);
}

// ---------- Chat ----------

export type ChatSendResult =
  | { ok: true; conversationId: string; answer: string; tokens: number }
  | { ok: false; error: string };

export async function sendChatMessage(
  conversationId: string | null,
  content: string
): Promise<ChatSendResult> {
  const viewer = await getViewer();
  const text = content.trim();
  if (!text) return { ok: false, error: "Mensagem vazia." };

  let settings: AISettings;
  try {
    settings = await requireConfigured();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }

  // Garante conversa DO PRÓPRIO usuário. Se veio um id, confirma que pertence a
  // ele (findFirst é escopado por dono pela extensão); senão, cria uma nova.
  let convId: string | null = conversationId;
  if (convId) {
    const owned = await prisma.aIConversation.findFirst({
      where: { id: convId },
      select: { id: true },
    });
    if (!owned) convId = null;
  }
  if (!convId) {
    const conv = await prisma.aIConversation.create({
      data: { title: text.slice(0, 60) },
    });
    convId = conv.id;
  }

  // Histórico (últimas N) + nova mensagem
  const history = await prisma.aIMessage.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT,
  });
  const messages: ChatMsg[] = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: text },
  ];

  let result;
  try {
    const system = await buildSystemPrompt(viewer);
    result = await chatComplete({ settings, system, messages });
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao consultar a IA." };
  }

  // Persiste as duas mensagens
  await prisma.aIMessage.create({
    data: { conversationId: convId, role: "user", content: text },
  });
  await prisma.aIMessage.create({
    data: {
      conversationId: convId,
      role: "assistant",
      content: result.text,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    },
  });
  await prisma.aIConversation.update({
    where: { id: convId },
    data: { updatedAt: new Date() },
  });

  revalidatePath("/assistente");
  return {
    ok: true,
    conversationId: convId,
    answer: result.text,
    tokens: result.usage.promptTokens + result.usage.completionTokens,
  };
}

export async function clearConversation(conversationId: string) {
  await getViewer();
  // deleteMany é escopado por dono → só apaga se a conversa for do próprio usuário.
  await prisma.aIConversation.deleteMany({ where: { id: conversationId } });
  revalidatePath("/assistente");
}

// ---------- Análise sob demanda ----------

export type InsightsResult = { ok: true; report: string; tokens: number } | { ok: false; error: string };

export async function generateInsights(): Promise<InsightsResult> {
  const viewer = await getViewer();
  let settings: AISettings;
  try {
    settings = await requireConfigured();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }

  const prompt = `Gere um RELATÓRIO PERSONALIZADO do meu momento financeiro, em markdown, com EXATAMENTE estas seções:
## Resumo
## Alertas
## Dicas práticas
## Boas práticas
## Próximos passos
Use os números reais do retrato financeiro. Seja específico e priorize o que tem mais impacto. No fim, em uma linha começando com "MEMÓRIAS:", liste de 1 a 3 padrões/fatos duráveis sobre meus hábitos (separados por "|") que valem guardar para personalizar futuras análises.`;

  let result;
  try {
    const system = await buildSystemPrompt(viewer);
    result = await chatComplete({
      settings,
      system,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1500,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao gerar análise." };
  }

  // Extrai memórias automáticas da última linha "MEMÓRIAS: a | b | c"
  let report = result.text;
  const memMatch = report.match(/MEM[ÓO]RIAS?:\s*(.+)\s*$/i);
  if (memMatch) {
    report = report.slice(0, memMatch.index).trim();
    const items = memMatch[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 3);
    for (const content of items) {
      await prisma.aIMemory.create({ data: { kind: "pattern", content, source: "auto" } });
    }
  }

  revalidatePath("/assistente");
  return { ok: true, report, tokens: result.usage.promptTokens + result.usage.completionTokens };
}

// ---------- Relatórios executivos com IA (admin) ----------

const REPORT_PROMPTS: Record<string, string> = {
  "resumo-mes": `Gere o RESUMO FINANCEIRO DO MÊS da agência, em markdown, com as seções:
## Visão geral (faturamento esperado × recebido, lucro, margem, caixa)
## O que foi bem
## O que preocupa
## Números-chave (tabela: indicador | valor | leitura)
## Próximos passos (numerados, priorizados por impacto)`,
  "plano-semana": `Monte meu PLANO DE AÇÃO SEMANAL de finanças da agência, em markdown:
## Cobranças prioritárias (quem, quanto, há quantos dias vencido, tom sugerido)
## Pagamentos da semana (o que vence em até 7 dias)
## Renovações para encaminhar
## Meta da semana (1 número para mover, com base no retrato)
Cada item com o valor em R$ e o motivo. Se não houver itens numa seção, diga "nada pendente".`,
  inadimplencia: `Gere o RELATÓRIO DE INADIMPLÊNCIA, em markdown:
## Panorama (total vencido, % da carteira, nº de clientes)
## Por cliente (valor, dias de atraso, faixa de aging, último contato, impacto na receita)
## Estratégia de cobrança sugerida (por faixa de atraso; use os 5 tons: lembrete amigável → cobrança formal)
## Risco (o que acontece com o caixa se nada for recuperado em 30 dias — deixe claro que é projeção)`,
  saude: `Gere a ANÁLISE DE SAÚDE FINANCEIRA da agência, em markdown:
## Diagnóstico (use o score do sistema e explique cada fator, bom e ruim)
## Comparação com limites saudáveis (folha ≤40%, fixas, inadimplência, caixa)
## Tendência (melhorando ou piorando? use os 6 meses do retrato)
## Recomendações (numeradas, com o efeito esperado em R$ quando possível)`,
  "projecao-caixa": `Gere a PROJEÇÃO DE CAIXA, em markdown:
## Posição atual (caixa disponível, composição)
## Projeção 30/60/90 dias (valores do retrato — explique a base de cálculo e marque como PROJEÇÃO)
## O que entra e o que sai (próximas cobranças e despesas do retrato)
## Cenários (o que muda se: 1. inadimplentes pagarem; 2. ninguém pagar; 3. despesas atrasarem)
## Ações para proteger o caixa`,
  "clientes-criticos": `Gere a ANÁLISE DE CLIENTES CRÍTICOS, em markdown:
## Critérios usados (inadimplência, atraso, peso na receita, renovação próxima)
## Clientes em risco (um bloco por cliente: situação, números, histórico de contato, recomendação)
## Clientes-chave a proteger (maiores geradores de receita e status)
## Plano de ação por cliente`,
  despesas: `Gere a ANÁLISE DE DESPESAS, em markdown:
## Composição (fixas × variáveis × folha, com %)
## Maiores categorias (do retrato, com valores)
## O que está pesando (compare com a receita e a tendência de 6 meses)
## Onde dá para cortar (sugestões concretas, marcadas como SUGESTÃO, com economia estimada em R$)
## Impacto no lucro se as sugestões forem aplicadas (PROJEÇÃO)`,
  crescimento: `Gere a ANÁLISE DE CRESCIMENTO, em markdown:
## Evolução (receita, MRR e lucro nos últimos 6 meses — cite os números)
## Motor de crescimento (novos clientes, TCV vendido, serviços que mais geram receita)
## Freios (churn implícito, inadimplência, dependência de poucos clientes — calcule a concentração)
## Recomendações para crescer com segurança`,
};

export type AIReportResult =
  | { ok: true; report: string; tokens: number }
  | { ok: false; error: string };

export async function generateAIReport(kind: string): Promise<AIReportResult> {
  const viewer = await requireAdmin();
  const prompt = REPORT_PROMPTS[kind];
  if (!prompt) return { ok: false, error: "Tipo de relatório inválido." };

  let settings: AISettings;
  try {
    settings = await requireConfigured();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }

  try {
    const system = await buildSystemPrompt(viewer);
    const result = await chatComplete({
      settings,
      system,
      messages: [
        {
          role: "user",
          content:
            prompt +
            "\n\nRegras: use SOMENTE os números do retrato; diferencie fato, projeção e sugestão; se faltar dado para alguma seção, escreva \"sem dados suficientes\" e diga onde cadastrar.",
        },
      ],
      maxTokens: 2000,
    });
    return {
      ok: true,
      report: result.text,
      tokens: result.usage.promptTokens + result.usage.completionTokens,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao gerar relatório." };
  }
}

// ---------- Memória / base de conhecimento ----------

export async function addMemory(formData: FormData) {
  await getViewer();
  const content = String(formData.get("content") || "").trim();
  const kind = String(formData.get("kind") || "note");
  if (!content) return;
  await prisma.aIMemory.create({ data: { content, kind, source: "manual" } });
  revalidatePath("/assistente");
}

export async function deleteMemory(id: string) {
  await getViewer();
  // deleteMany é escopado por dono → só apaga memória do próprio usuário.
  await prisma.aIMemory.deleteMany({ where: { id } });
  revalidatePath("/assistente");
}

export async function toggleMemoryPin(id: string) {
  await getViewer();
  // findUnique é pós-filtrado por dono → memória de outro usuário volta null.
  const m = await prisma.aIMemory.findUnique({ where: { id } });
  if (!m) return;
  await prisma.aIMemory.update({ where: { id }, data: { pinned: !m.pinned } });
  revalidatePath("/assistente");
}
