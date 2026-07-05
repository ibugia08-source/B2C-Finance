import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";
import { getAISettingsView } from "@/lib/actions/ai";
import { AISettingsDialog } from "./settings-dialog";
import { Chat } from "./chat";
import { Insights } from "./insights";
import { MemoryPanel } from "./memory-panel";
import { AIReportsPanel } from "./reports-panel";
import { Sparkles, Bot, FileBarChart2 } from "lucide-react";

export default async function AssistentePage() {
  // Aberto a qualquer usuário logado. Cada um vê o próprio histórico e memórias
  // (AIConversation/AIMemory são escopados por dono). Só o admin configura a chave.
  const viewer = await getViewer("/assistente");
  const isAdmin = viewer.role === "ADMIN";

  const [settings, conversation, memories] = await Promise.all([
    getAISettingsView(),
    prisma.aIConversation.findFirst({
      orderBy: { updatedAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.aIMemory.findMany({ orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] }),
  ]);

  const configured = settings.enabled && settings.hasKey && !!settings.model;

  const initialMessages =
    conversation?.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })) ?? [];
  const initialTokens =
    conversation?.messages.reduce(
      (s, m) => s + (m.promptTokens ?? 0) + (m.completionTokens ?? 0),
      0
    ) ?? 0;

  return (
    <div>
      <PageHeader
        title="Assistente IA"
        description={
          isAdmin
            ? "Copiloto financeiro da B2C Gestão: analisa os dados reais da agência, antecipa problemas e apoia decisões."
            : "Seu copiloto financeiro: análises, dicas, alertas e relatórios sobre os seus dados."
        }
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={configured ? "success" : "secondary"}>
              {configured ? `Ativa · ${settings.model}` : "Não configurada"}
            </Badge>
            {isAdmin && <AISettingsDialog settings={settings} />}
          </div>
        }
      />

      {!configured && (
        <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">
                {isAdmin ? "Conecte sua IA para começar" : "Assistente ainda não disponível"}
              </p>
              <p className="text-sm text-muted-foreground">
                {isAdmin
                  ? "Informe o provedor (OpenAI, Anthropic ou compatível), o modelo e sua chave de API. A IA passa a analisar suas transações, faturas, gastos, pessoas e metas. O consumo de tokens é cobrado pelo provedor que você configurar."
                  : "O administrador ainda não configurou a inteligência artificial. Assim que ele conectar uma chave, o assistente fica disponível para analisar os seus dados."}
              </p>
            </div>
            {isAdmin && <AISettingsDialog settings={settings} />}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-primary" /> Conversa
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Chat
              conversationId={conversation?.id ?? null}
              initialMessages={initialMessages}
              configured={configured}
              initialTokens={initialTokens}
              agency={isAdmin}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          {isAdmin && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileBarChart2 className="h-4 w-4 text-primary" /> Relatórios executivos com IA
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AIReportsPanel configured={configured} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Análise rápida</CardTitle>
            </CardHeader>
            <CardContent>
              <Insights configured={configured} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Memória & conhecimento</CardTitle>
            </CardHeader>
            <CardContent>
              <MemoryPanel memories={memories} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
