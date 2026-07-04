import { prisma } from "@/lib/prisma";

export type AIProvider = "openai" | "anthropic" | "custom";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type ChatResult = {
  text: string;
  usage: { promptTokens: number; completionTokens: number };
};

export type AISettings = {
  provider: AIProvider;
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  temperature: number;
  enabled: boolean;
};

const SINGLETON_ID = "default";

export async function getAISettings(): Promise<AISettings | null> {
  const s = await prisma.aISetting.findUnique({ where: { id: SINGLETON_ID } });
  if (!s) return null;
  return {
    provider: (s.provider as AIProvider) ?? "openai",
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    model: s.model,
    temperature: s.temperature,
    enabled: s.enabled,
  };
}

export function isConfigured(s: AISettings | null): s is AISettings {
  return !!s && s.enabled && !!s.apiKey && !!s.model;
}

/** Mensagem amigável quando a IA não está pronta. */
export class AINotConfiguredError extends Error {
  constructor() {
    super(
      "A IA ainda não está configurada. Abra as configurações do Assistente e informe seu provedor, modelo e chave de API."
    );
  }
}

function openAiBase(s: AISettings): string {
  if (s.provider === "custom" && s.baseUrl) return s.baseUrl.replace(/\/$/, "");
  return "https://api.openai.com/v1";
}

/**
 * Chamada de chat agnóstica de provedor. Lança Error com mensagem legível em
 * caso de falha (chave inválida, rede, etc.).
 */
export async function chatComplete(opts: {
  settings: AISettings;
  system: string;
  messages: ChatMsg[];
  maxTokens?: number;
}): Promise<ChatResult> {
  const { settings: s, system, messages, maxTokens = 1200 } = opts;
  if (!s.apiKey) throw new AINotConfiguredError();

  if (s.provider === "anthropic") {
    return anthropicChat(s, system, messages, maxTokens);
  }
  return openAiChat(s, system, messages, maxTokens);
}

async function openAiChat(
  s: AISettings,
  system: string,
  messages: ChatMsg[],
  maxTokens: number
): Promise<ChatResult> {
  const url = `${openAiBase(s)}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.apiKey}`,
      },
      body: JSON.stringify({
        model: s.model,
        temperature: s.temperature,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });
  } catch (e: any) {
    throw new Error(`Falha de rede ao contatar o provedor: ${e?.message ?? e}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(prettyHttpError(res.status, body));
  }
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return {
    text: String(text).trim(),
    usage: {
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      completionTokens: data?.usage?.completion_tokens ?? 0,
    },
  };
}

async function anthropicChat(
  s: AISettings,
  system: string,
  messages: ChatMsg[],
  maxTokens: number
): Promise<ChatResult> {
  const url = "https://api.anthropic.com/v1/messages";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": s.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: s.model,
        max_tokens: maxTokens,
        temperature: s.temperature,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  } catch (e: any) {
    throw new Error(`Falha de rede ao contatar o provedor: ${e?.message ?? e}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(prettyHttpError(res.status, body));
  }
  const data: any = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content.map((c: any) => c?.text ?? "").join("")
    : "";
  return {
    text: String(text).trim(),
    usage: {
      promptTokens: data?.usage?.input_tokens ?? 0,
      completionTokens: data?.usage?.output_tokens ?? 0,
    },
  };
}

function prettyHttpError(status: number, body: string): string {
  let detail = body;
  try {
    const j = JSON.parse(body);
    detail = j?.error?.message ?? j?.message ?? body;
  } catch {
    /* mantém texto cru */
  }
  if (status === 401 || status === 403)
    return "Chave de API inválida ou sem permissão. Verifique a chave nas configurações.";
  if (status === 404)
    return `Modelo não encontrado (404). Verifique o nome do modelo. Detalhe: ${detail}`;
  if (status === 429)
    return "Limite de uso/críditos atingido no provedor (429). Tente mais tarde ou verifique seu plano.";
  return `Erro do provedor (${status}): ${String(detail).slice(0, 300)}`;
}

/** Teste de conexão curto e barato. */
export async function testConnection(s: AISettings): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await chatComplete({
      settings: s,
      system: "Você é um verificador de conexão. Responda apenas: OK.",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 5,
    });
    return { ok: true, message: `Conexão OK (resposta: "${r.text.slice(0, 20)}").` };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "Falha desconhecida." };
  }
}
