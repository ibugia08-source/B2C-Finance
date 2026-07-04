"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { saveAISettings, testAIConnection, type AISettingsView } from "@/lib/actions/ai";
import { Settings, Plug } from "lucide-react";

const PROVIDER_HINTS: Record<string, { model: string; help: string }> = {
  openai: { model: "gpt-4o-mini", help: "Use sua chave da OpenAI (sk-...). Modelos: gpt-4o, gpt-4o-mini…" },
  anthropic: { model: "claude-sonnet-4-6", help: "Use sua chave da Anthropic. Modelos: claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5…" },
  custom: { model: "", help: "Compatível com OpenAI (OpenRouter, Groq, Together, Ollama/LM Studio). Informe a URL base." },
};

export function AISettingsDialog({
  settings,
  trigger,
}: {
  settings: AISettingsView;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(settings.provider);
  const [pending, start] = useTransition();
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-1" /> Configurar IA
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurar Assistente de IA</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              await saveAISettings(fd);
              setTest(null);
              setOpen(false);
            })
          }
          className="space-y-3"
        >
          <div>
            <Label>Provedor</Label>
            <Select name="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="openai">OpenAI (GPT)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="custom">Compatível com OpenAI (OpenRouter, Groq, local…)</option>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">{PROVIDER_HINTS[provider]?.help}</p>
          </div>

          {provider === "custom" && (
            <div>
              <Label>URL base</Label>
              <Input
                name="baseUrl"
                defaultValue={settings.baseUrl}
                placeholder="https://openrouter.ai/api/v1"
              />
            </div>
          )}

          <div>
            <Label>Modelo</Label>
            <Input
              name="model"
              defaultValue={settings.model}
              placeholder={PROVIDER_HINTS[provider]?.model || "nome-do-modelo"}
            />
          </div>

          <div>
            <Label>Chave de API</Label>
            <Input
              name="apiKey"
              type="password"
              defaultValue={settings.hasKey ? "••••••••••••" : ""}
              placeholder="Cole sua chave de API"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {settings.hasKey
                ? "Chave já salva. Deixe os pontos para manter, ou cole uma nova para substituir."
                : "A chave fica salva localmente no banco do app."}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Temperatura</Label>
              <Input
                name="temperature"
                type="number"
                step="0.1"
                min={0}
                max={2}
                defaultValue={settings.temperature}
              />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                name="enabled"
                id="ai-enabled"
                defaultChecked={settings.enabled}
              />
              <Label htmlFor="ai-enabled">IA ativa</Label>
            </div>
          </div>

          {test && (
            <div
              className={`rounded-md border p-2 text-sm ${
                test.ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {test.message}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await testAIConnection();
                  setTest(r);
                })
              }
            >
              <Plug className="h-4 w-4 mr-1" /> Testar conexão
            </Button>
            <Button type="submit" disabled={pending}>
              Salvar
            </Button>
          </DialogFooter>
          <p className="text-[11px] text-muted-foreground">
            Dica: salve a configuração antes de testar a conexão.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
