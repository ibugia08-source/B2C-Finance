import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/viewer";
import { getWhatsAppSettingsView } from "@/lib/actions/whatsapp";
import { WhatsAppSettingsDialog } from "./settings-dialog";
import { WhatsAppSimulator } from "./simulator";
import { MessageCircle, Webhook } from "lucide-react";

const DIR_LABEL: Record<string, string> = { in: "Recebida", out: "Enviada" };

export default async function WhatsAppPage() {
  await requireAdmin();

  const [settings, messages] = await Promise.all([
    getWhatsAppSettingsView(),
    prisma.whatsAppMessage.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const webhookUrl = `${proto}://${host}/api/whatsapp/webhook`;

  const connected = settings.enabled && !!settings.baseUrl && !!settings.myNumber;

  return (
    <div>
      <PageHeader
        title="Agente IA"
        description="Seu agente financeiro no WhatsApp: registre despesas, receitas e caixa por mensagem ou foto, e receba lembretes."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={connected ? "success" : "secondary"}>
              {connected ? "Conectado" : "Não configurado"}
            </Badge>
            <WhatsAppSettingsDialog settings={settings} />
          </div>
        }
      />

      {!connected && (
        <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
              <MessageCircle className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">Conecte seu WhatsApp</p>
              <p className="text-sm text-muted-foreground">
                Cadastre as credenciais do seu gateway (Z-API/Evolution), seu número pessoal e ative.
                Depois aponte o <strong>webhook</strong> do gateway para a URL abaixo. Enquanto isso,
                use o <strong>simulador</strong> para testar o agente. A IA usa a chave configurada no
                módulo <strong>Assistente IA</strong>.
              </p>
            </div>
            <WhatsAppSettingsDialog settings={settings} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Simulador do agente</CardTitle>
          </CardHeader>
          <CardContent>
            <WhatsAppSimulator />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Webhook className="h-4 w-4" /> Webhook
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Cole esta URL no campo de webhook do seu gateway (evento de mensagem recebida):
              </p>
              <code className="block text-xs break-all rounded-md border bg-muted/50 p-2">
                {webhookUrl}
              </code>
              <p className="text-[11px] text-muted-foreground">
                Lembretes (cron): <code className="break-all">{`${proto}://${host}/api/whatsapp/reminders?secret=SEU_SEGREDO`}</code>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Como funciona</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1.5">
              <p>• Só o seu número cadastrado comanda o agente.</p>
              <p>• Envie texto ou foto de comprovante → o agente registra no app.</p>
              <p>• Receba lembretes de faturas e despesas a vencer.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Mensagens recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 border-b last:border-0 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <Badge variant={m.direction === "in" ? "outline" : "secondary"} className="text-[10px]">
                        {DIR_LABEL[m.direction] ?? m.direction}
                      </Badge>
                      {m.intent && <span className="text-[11px] text-muted-foreground">{m.intent}</span>}
                      {m.status === "error" && (
                        <Badge variant="destructive" className="text-[10px]">erro</Badge>
                      )}
                    </span>
                    <p className="truncate text-foreground/90 mt-0.5">{m.body}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                    {new Date(m.createdAt).toLocaleString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
