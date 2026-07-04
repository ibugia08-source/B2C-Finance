import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getAISettings, isConfigured, chatComplete, type AISettings } from "@/lib/ai/provider";
import { buildFinancialSnapshot, snapshotToText, loadMemoryText } from "@/lib/ai/context";

export type AgentResult = {
  reply: string;
  action: string;
  created?: any;
  error?: string;
};

export async function runAgent(input: {
  text?: string;
  imageUrl?: string;
  from?: string;
}): Promise<AgentResult> {
  const ai = await getAISettings();
  if (!isConfigured(ai)) {
    return {
      reply:
        "⚠️ A IA ainda não está configurada no app (módulo Assistente IA). Configure sua chave para eu funcionar.",
      action: "error",
      error: "ai_not_configured",
    };
  }

  const [people, categories, cashboxes] = await Promise.all([
    prisma.person.findMany({ select: { id: true, name: true } }),
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.cashBox.findMany({ select: { id: true, name: true } }),
  ]);

  const snapshot = snapshotToText(await buildFinancialSnapshot());
  const memory = await loadMemoryText();
  const today = new Date().toISOString().slice(0, 10);

  const system = `Você é o "B2C", agente financeiro do app B2C Finance operando no WhatsApp.
Interprete a mensagem (ou a imagem de comprovante/nota) do usuário e decida UMA ação.
Responda SOMENTE com um JSON válido (sem texto fora do JSON), no formato:
{"action":"add_expense|add_income|add_cashbox|add_cash_movement|query|smalltalk","fields":{...},"reply":"mensagem curta e amigável em pt-BR"}

Regras:
- Hoje é ${today}. Converta "hoje", "ontem", "amanhã" em datas YYYY-MM-DD.
- Valores em reais, número com ponto decimal (ex.: 50.00).
- add_expense.fields: {description, amount, date, origin(debito|pix|dinheiro|boleto), status(pendente|pago), dueDate?, installments?(int), personName?, categoryName?}
- add_income.fields: {description, amount, receivedAt, sourceType(BANK_ACCOUNT|PIX|TRANSFER|CASH), incomeType(SALARY|EARNINGS|COMPANY_WITHDRAWAL|SALE|OTHER), status(RECEIVED|EXPECTED), personName?, categoryName?}
- add_cashbox.fields: {name, currentAmount, type(PERSONAL|EMERGENCY|INVESTMENT|COMPANY|GOAL|OTHER)}
- add_cash_movement.fields: {cashboxName, type(IN|OUT), amount, date, description?}
- Use exatamente os nomes das listas abaixo quando o usuário citar pessoa/categoria/caixa; se não houver correspondência, deixe em branco.
- "query": responda perguntas sobre as finanças usando o RETRATO abaixo (resposta em "reply", fields vazio).
- "smalltalk": saudações ou quando não há ação clara.
- Sempre preencha "reply" confirmando (ex.: "✅ Despesa de R$ 50,00 no mercado registrada (pix, hoje).").

PESSOAS: ${people.map((p) => p.name).join(", ") || "(nenhuma)"}
CATEGORIAS: ${categories.map((c) => c.name).join(", ") || "(nenhuma)"}
CAIXAS: ${cashboxes.map((c) => c.name).join(", ") || "(nenhum)"}

===== RETRATO FINANCEIRO =====
${snapshot}${memory ? "\n\n===== MEMÓRIA =====\n" + memory : ""}`;

  let raw: string;
  try {
    if (input.imageUrl) {
      raw = await visionComplete(
        ai,
        system,
        input.text || "Analise a imagem (comprovante/nota fiscal) e registre a despesa correspondente.",
        input.imageUrl
      );
    } else {
      const r = await chatComplete({
        settings: ai,
        system,
        messages: [{ role: "user", content: input.text || "" }],
        maxTokens: 700,
      });
      raw = r.text;
    }
  } catch (e: any) {
    return {
      reply: "Tive um problema ao processar com a IA: " + (e?.message ?? e),
      action: "error",
      error: String(e?.message ?? e),
    };
  }

  const parsed = parseJson(raw);
  if (!parsed || !parsed.action) {
    return { reply: (raw || "Não entendi, pode reformular?").slice(0, 600), action: "smalltalk" };
  }

  const f = parsed.fields ?? {};
  const reply = String(parsed.reply || "Feito!");
  const findPerson = nameMatcher(people);
  const findCat = nameMatcher(categories);
  const findBox = nameMatcher(cashboxes);

  try {
    switch (parsed.action) {
      case "add_expense": {
        const amount = num(f.amount);
        const installments = Math.max(1, Math.min(60, parseInt(f.installments) || 1));
        const due = f.dueDate ? parseDate(f.dueDate) : null;
        const tx = await prisma.transaction.create({
          data: {
            date: parseDate(f.date),
            description: String(f.description || "Despesa"),
            amount,
            type: "despesa",
            origin: ["debito", "pix", "dinheiro", "boleto"].includes(f.origin) ? f.origin : "debito",
            cardId: null,
            status: f.status === "pago" ? "pago" : "pendente",
            belongsTo: "pessoal",
            dueDate: due,
            responsibleId: findPerson(f.personName)?.id ?? null,
            categoryId: findCat(f.categoryName)?.id ?? null,
            hash: null,
          },
        });
        if (installments > 1) {
          const each = Number((amount / installments).toFixed(2));
          const first = due ?? parseDate(f.date);
          await prisma.installment.createMany({
            data: Array.from({ length: installments }, (_, i) => ({
              transactionId: tx.id,
              number: i + 1,
              total: installments,
              amount: each,
              dueDate: new Date(first.getFullYear(), first.getMonth() + i, first.getDate()),
              paid: false,
            })),
          });
        }
        revalidateAll();
        return { reply, action: "add_expense", created: { id: tx.id } };
      }

      case "add_income": {
        const inc = await prisma.income.create({
          data: {
            description: String(f.description || "Receita"),
            amount: num(f.amount),
            receivedAt: parseDate(f.receivedAt),
            sourceType: f.sourceType || "BANK_ACCOUNT",
            incomeType: f.incomeType || "OTHER",
            status: f.status === "EXPECTED" ? "EXPECTED" : "RECEIVED",
            personId: findPerson(f.personName)?.id ?? null,
            categoryId: findCat(f.categoryName)?.id ?? null,
            date: parseDate(f.receivedAt),
            source: f.sourceType || "BANK_ACCOUNT",
          },
        });
        revalidateAll();
        return { reply, action: "add_income", created: { id: inc.id } };
      }

      case "add_cashbox": {
        const cb = await prisma.cashBox.create({
          data: {
            name: String(f.name || "Caixa"),
            currentAmount: num(f.currentAmount),
            type: f.type || "PERSONAL",
          },
        });
        revalidateAll();
        return { reply, action: "add_cashbox", created: { id: cb.id } };
      }

      case "add_cash_movement": {
        const box = findBox(f.cashboxName);
        if (!box) {
          return {
            reply: "Não encontrei esse caixa. Crie-o primeiro ou me diga o nome exato.",
            action: "add_cash_movement",
            error: "box_not_found",
          };
        }
        const amount = num(f.amount);
        const type = f.type === "OUT" ? "OUT" : "IN";
        const cur = (await prisma.cashBox.findUnique({ where: { id: box.id } }))!.currentAmount;
        await prisma.$transaction([
          prisma.cashBoxMovement.create({
            data: {
              cashBoxId: box.id,
              type,
              amount,
              date: parseDate(f.date),
              description: f.description || null,
            },
          }),
          prisma.cashBox.update({
            where: { id: box.id },
            data: { currentAmount: cur + (type === "IN" ? amount : -amount) },
          }),
        ]);
        revalidateAll();
        return { reply, action: "add_cash_movement", created: { cashBoxId: box.id } };
      }

      default:
        return { reply, action: parsed.action };
    }
  } catch (e: any) {
    return {
      reply: "Entendi o pedido, mas houve um erro ao registrar: " + (e?.message ?? e),
      action: parsed.action,
      error: String(e?.message ?? e),
    };
  }
}

// ---------- helpers ----------

function revalidateAll() {
  for (const p of ["/dashboard", "/despesas", "/receitas", "/caixa", "/transacoes", "/pessoas"]) {
    try {
      revalidatePath(p);
    } catch {
      /* fora de contexto de request (ex.: cron) — ignora */
    }
  }
}

function num(v: any): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "0").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : Number(String(v ?? "0").replace(",", ".")) || 0;
}

function parseDate(v: any): Date {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    const [y, m, d] = String(v).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

function nameMatcher<T extends { id: string; name: string }>(list: T[]) {
  return (name?: string): T | null => {
    if (!name) return null;
    const q = name.trim().toLowerCase();
    return (
      list.find((x) => x.name.toLowerCase() === q) ??
      list.find((x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase())) ??
      null
    );
  };
}

function parseJson(raw: string): any | null {
  if (!raw) return null;
  let t = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Chamada de visão (OpenAI / compatível). Retorna o texto do modelo. */
async function visionComplete(
  s: AISettings,
  system: string,
  prompt: string,
  imageUrl: string
): Promise<string> {
  const base =
    s.provider === "custom" && s.baseUrl ? s.baseUrl.replace(/\/$/, "") : "https://api.openai.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({
      model: s.model,
      max_tokens: 700,
      temperature: s.temperature,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Visão falhou (${res.status}): ${t.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}
