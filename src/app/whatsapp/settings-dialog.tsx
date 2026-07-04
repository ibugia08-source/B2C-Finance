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
import {
  saveWhatsAppSettings,
  testWhatsAppSend,
  type WhatsAppSettingsView,
} from "@/lib/actions/whatsapp";
import { Settings, Send } from "lucide-react";

export function WhatsAppSettingsDialog({
  settings,
  trigger,
}: {
  settings: WhatsAppSettingsView;
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
            <Settings className="h-4 w-4 mr-1" /> Configurar WhatsApp
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurar WhatsApp</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              await saveWhatsAppSettings(fd);
              setTest(null);
              setOpen(false);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <div className="col-span-2">
            <Label>Provedor (gateway)</Label>
            <Select name="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="zapi">Z-API</option>
              <option value="evolution">Evolution API</option>
              <option value="custom">Outro (compatível com Z-API)</option>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>URL base da API</Label>
            <Input
              name="baseUrl"
              defaultValue={settings.baseUrl}
              placeholder={
                provider === "evolution" ? "https://sua-evolution.com" : "https://api.z-api.io"
              }
            />
          </div>

          <div>
            <Label>Instance ID</Label>
            <Input name="instanceId" defaultValue={settings.instanceId} placeholder="ID da instância" />
          </div>
          <div>
            <Label>Token da instância</Label>
            <Input
              name="token"
              type="password"
              defaultValue={settings.hasToken ? "••••••••" : ""}
              placeholder="token"
              autoComplete="off"
            />
          </div>

          {provider !== "evolution" && (
            <div className="col-span-2">
              <Label>Client-Token (segurança da conta Z-API)</Label>
              <Input
                name="clientToken"
                type="password"
                defaultValue={settings.hasClientToken ? "••••••••" : ""}
                placeholder="Client-Token"
                autoComplete="off"
              />
            </div>
          )}

          <div>
            <Label>Meu número (com DDI)</Label>
            <Input name="myNumber" defaultValue={settings.myNumber} placeholder="5511999999999" />
          </div>
          <div>
            <Label>Segredo dos lembretes</Label>
            <Input
              name="remindersSecret"
              defaultValue={settings.remindersSecret}
              placeholder="ex.: b2c-cron-2026"
            />
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" name="enabled" id="wa-enabled" defaultChecked={settings.enabled} />
            <Label htmlFor="wa-enabled">WhatsApp ativo</Label>
          </div>

          {test && (
            <div
              className={`col-span-2 rounded-md border p-2 text-sm ${
                test.ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {test.message}
            </div>
          )}

          <DialogFooter className="col-span-2 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => start(async () => setTest(await testWhatsAppSend()))}
            >
              <Send className="h-4 w-4 mr-1" /> Enviar teste
            </Button>
            <Button type="submit" disabled={pending}>
              Salvar
            </Button>
          </DialogFooter>
          <p className="col-span-2 text-[11px] text-muted-foreground">
            Salve a configuração antes de testar o envio. Use o número pessoal que vai conversar com o agente.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
