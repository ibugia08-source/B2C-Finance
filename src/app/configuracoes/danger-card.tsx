"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { limparSistemaAction } from "@/lib/actions/limpar-sistema";
import { FRASE_DE_CONFIRMACAO } from "@/lib/limpar-sistema-meta";
import { AlertTriangle, Trash2 } from "lucide-react";

/**
 * ZONA DE RISCO — limpar o sistema (só ADMIN vê este cartão).
 *
 * O gesto é irreversível e a tela não finge o contrário: diz o que fica, o
 * que sai, e exige a frase digitada. Sem "tem certeza?" genérico — a
 * consequência está escrita, como 02 §7.6 manda.
 */
export function DangerCard() {
  const [open, setOpen] = useState(false);
  const [frase, setFrase] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const pronta = frase.trim() === FRASE_DE_CONFIRMACAO;

  return (
    <Card className="mt-6 border-destructive/40">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-dense font-medium text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Zona de risco — limpar o sistema
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            Apaga TODO o movimento: clientes, cobranças, pagamentos, despesas,
            avaliações, fotografias e histórico. Ficam os usuários, a agência,
            o plano de contas, as métricas e as configurações. Sem backup
            automático e sem desfazer.
          </p>
          {feito && <p className="mt-1 text-caption font-medium text-success">{feito}</p>}
        </div>
        <Button variant="destructive" onClick={() => { setFrase(""); setErro(null); setOpen(true); }}>
          <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Limpar o sistema
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar todos os dados do sistema?</DialogTitle>
            <DialogDescription>
              Todo o movimento é apagado agora e não há como desfazer. A
              estrutura (usuários, agência, plano de contas, métricas,
              categorias e modelos) permanece. Para confirmar, digite{" "}
              <strong>{FRASE_DE_CONFIRMACAO}</strong> abaixo.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="frase-limpeza">Confirmação</Label>
            <Input
              id="frase-limpeza"
              value={frase}
              onChange={(e) => setFrase(e.target.value)}
              placeholder={FRASE_DE_CONFIRMACAO}
              autoComplete="off"
            />
            {erro && <p className="mt-1.5 text-caption text-destructive">{erro}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!pronta || pending}
              onClick={() =>
                start(async () => {
                  const r = await limparSistemaAction(frase.trim());
                  if (r.ok) {
                    setOpen(false);
                    setFeito(
                      `Sistema limpo: ${r.registrosApagados} registro(s) apagado(s) em ${r.tabelasApagadas} tabela(s); estrutura preservada (${r.estrutura.tabelas} tabelas).`
                    );
                    router.refresh();
                  } else {
                    setErro(r.error);
                  }
                })
              }
            >
              {pending ? "Limpando…" : "Apagar tudo agora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
