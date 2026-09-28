"use client";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { API_SCOPE_GROUPS } from "@/lib/api/scopes";
import { criarIntegracaoAction } from "@/lib/actions/integrations";
import { TokenReveal } from "./token-reveal";

/**
 * Criar integração: nome, descrição, scopes e validade. Ao salvar, o mesmo
 * diálogo vira a tela do token — mostrado uma única vez.
 */
export function NovaIntegracaoDialog() {
  const [open, setOpen] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [pendente, start] = useTransition();

  function fechar(o: boolean) {
    setOpen(o);
    if (!o) {
      setErro(null);
      setToken(null);
      setMarcados(new Set());
    }
  }

  function alternar(id: string) {
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Nova integração
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {token ? (
          <>
            <DialogHeader>
              <DialogTitle>Integração criada</DialogTitle>
              <DialogDescription>Este é o token da integração.</DialogDescription>
            </DialogHeader>
            <TokenReveal token={token} />
            <DialogFooter>
              <Button type="button" onClick={() => fechar(false)}>
                Já guardei o token
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Nova integração</DialogTitle>
              <DialogDescription>
                Uma conta de serviço para um sistema externo. Ela só pode o que os scopes marcados permitem.
              </DialogDescription>
            </DialogHeader>
            <form
              action={(fd) =>
                start(async () => {
                  setErro(null);
                  const res = await criarIntegracaoAction(fd);
                  if (res.ok) setToken(res.token);
                  else setErro(res.error);
                })
              }
              className="space-y-4"
            >
              <div>
                <Label htmlFor="int-nome">Nome *</Label>
                <Input id="int-nome" name="name" required maxLength={80} placeholder="ex.: B2C Finance AI Agent" />
              </div>
              <div>
                <Label htmlFor="int-desc">Descrição</Label>
                <Textarea
                  id="int-desc"
                  name="description"
                  maxLength={300}
                  rows={2}
                  placeholder="ex.: Agente do WhatsApp no n8n — consulta de recebimentos"
                />
              </div>
              <fieldset>
                <legend className="text-sm font-medium">Scopes *</legend>
                <p className="mb-2 text-caption text-muted-foreground">
                  Marque só o necessário. Exclusões, usuários, permissões e reabertura de competência não
                  existem para integrações.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {API_SCOPE_GROUPS.map((g) => (
                    <div key={g.key} className="rounded-lg border p-3">
                      <p className="mb-1.5 text-caption font-medium uppercase tracking-wide text-muted-foreground">
                        {g.label}
                      </p>
                      <ul className="space-y-1.5">
                        {g.scopes.map((s) => (
                          <li key={s.id}>
                            <label className="flex cursor-pointer items-start gap-2 text-dense">
                              <Checkbox
                                name="scopes"
                                value={s.id}
                                checked={marcados.has(s.id)}
                                onChange={() => alternar(s.id)}
                                className="mt-0.5"
                              />
                              <span>
                                {s.label}
                                <span className="block font-mono text-caption text-muted-foreground">
                                  {s.id}
                                  {s.write ? " · escrita" : ""}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </fieldset>
              <div>
                <Label htmlFor="int-validade">Validade do token</Label>
                <Select id="int-validade" name="expiresInDays" defaultValue="180">
                  <option value="30">30 dias</option>
                  <option value="90">90 dias</option>
                  <option value="180">180 dias (recomendado)</option>
                  <option value="365">1 ano</option>
                  <option value="never">Sem expiração</option>
                </Select>
              </div>
              {erro && (
                <p role="alert" className="text-dense text-danger-ink">
                  {erro}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => fechar(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pendente || marcados.size === 0}>
                  {pendente ? "Criando…" : "Criar chave"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
