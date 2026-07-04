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

async function requireConfigured(): Promise<AISettings> {
  const s = await getAISettings();
  if (!isConfigured(s)) {
    throw new Error(
      "A IA ainda não está configurada. Abra as configurações do Assistente e informe provedor, modelo e chave de API (e marque como ativa)."
    );
  }
  return s;
}

async function buildSystemPrompt(): Promise<string> {
  const snapshot = await buildFinancialSnapshot();
  const memory = await loadMemoryText();
  const parts = [
    BASE_ROLE,
    "\n===== RETRATO FINANCEIRO ATUAL =====\n" + snapshotToText(snapshot),
  ];
  if (memory) {
    parts.push(
      "\n===== MEMÓRIA / CONHECIMENTO SOBRE O USUÁRIO =====\n" +
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
  await getViewer();
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
    const system = await buildSystemPrompt();
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
  await getViewer();
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
    const system = await buildSystemPrompt();
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
