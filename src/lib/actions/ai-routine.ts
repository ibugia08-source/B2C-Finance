"use server";
import { requireAdmin } from "@/lib/auth/viewer";

/**
 * Sugestões inteligentes da ROTINA (PARTE 12): a IA analisa APENAS o retrato
 * real da agência (snapshot da camada central de cálculos) e devolve ações
 * priorizadas. Sem dados suficientes, ela deve dizer isso — nunca inventar.
 */

export type RoutineSuggestion = {
  priority: "alta" | "media" | "baixa";
  insight: string; // o que está acontecendo (fato com números)
  reason: string; // por que isso importa
  action: string; // o que fazer agora
};

export type RoutineAIResult =
  | { ok: true; suggestions: RoutineSuggestion[]; note?: string }
  | { ok: false; error: string };

export async function generateRoutineSuggestions(): Promise<RoutineAIResult> {
  await requireAdmin();
  try {
    const { getAISettings, isConfigured, chatComplete } = await import("@/lib/ai/provider");
    const settings = await getAISettings();
    if (!isConfigured(settings)) {
      return {
        ok: false,
        error: "IA não configurada. Configure o provedor em /assistente para receber sugestões.",
      };
    }

    const { buildAgencySnapshotText } = await import("@/lib/ai/agency-context");
    const snapshot = await buildAgencySnapshotText();

    const system = `Você é o co-piloto financeiro da B2C Gestão (agência de marketing). Analise o RETRATO DA AGÊNCIA abaixo — dados 100% reais do sistema — e gere de 3 a 8 sugestões de ação para o administrador executar HOJE/nesta semana.

REGRAS INVIOLÁVEIS:
- Use APENAS números e fatos presentes no retrato. NUNCA invente clientes, valores ou situações.
- Se não houver dados suficientes para uma categoria, não sugira nada sobre ela.
- Se o retrato estiver praticamente vazio, devolva uma única sugestão de prioridade "baixa" explicando que ainda não há dados suficientes.
- Priorize por: impacto financeiro, urgência, dias de atraso, valor envolvido, proximidade de vencimento, risco de perda, potencial de receita e efeito na margem.
- Temas possíveis: quem cobrar primeiro, cliente com risco de atraso/perda, despesa a revisar, renovação a priorizar, upsell com maior potencial, responsável que precisa de atenção, cenário financeiro se formando, como melhorar a margem.

Fale como um analista financeiro simples e direto, em 3 blocos por sugestão:
- insight: O QUE ESTÁ ACONTECENDO — o fato, com os números do retrato (ex.: "R$ 4.500 vencidos, concentrados em 3 clientes").
- reason: POR QUE ISSO IMPORTA — o efeito prático no caixa/margem/risco.
- action: O QUE FAZER AGORA — frase imperativa curta e executável.

Responda APENAS com JSON válido (sem markdown):
{"suggestions":[{"priority":"alta|media|baixa","insight":"o que está acontecendo, com números","reason":"por que importa","action":"o que fazer agora"}]}`;

    const result = await chatComplete({
      settings,
      system,
      messages: [{ role: "user", content: `RETRATO DA AGÊNCIA:\n${snapshot}` }],
      maxTokens: 1200,
    });

    const raw = result.text.replace(/```json|```/g, "").trim();
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const list = Array.isArray(json?.suggestions) ? json.suggestions : [];

    const valid: RoutineSuggestion[] = list
      .filter(
        (s: any) =>
          s && typeof s.action === "string" && typeof s.reason === "string"
      )
      .map((s: any) => ({
        priority: ["alta", "media", "baixa"].includes(s.priority) ? s.priority : "media",
        insight: String(s.insight ?? "").slice(0, 300),
        reason: String(s.reason).slice(0, 400),
        action: String(s.action).slice(0, 240),
      }))
      .slice(0, 8);

    if (valid.length === 0) {
      return {
        ok: true,
        suggestions: [],
        note: "A IA não encontrou ações relevantes com os dados atuais.",
      };
    }

    const order = { alta: 0, media: 1, baixa: 2 } as const;
    valid.sort((a, b) => order[a.priority] - order[b.priority]);
    return { ok: true, suggestions: valid };
  } catch (e: any) {
    console.error("generateRoutineSuggestions", e);
    return {
      ok: false,
      error: "Não consegui gerar sugestões agora. Tente novamente em instantes.",
    };
  }
}
