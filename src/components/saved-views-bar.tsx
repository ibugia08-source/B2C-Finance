"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { saveView, deleteView, type SavedViewItem } from "@/lib/actions/saved-views";
import { Bookmark, BookmarkPlus, Globe, Lock, X } from "lucide-react";

/** Barra de visões salvas: aplicar, salvar a visão atual, excluir. */
export function SavedViewsBar({
  module,
  views,
}: {
  module: string;
  views: SavedViewItem[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const currentParams = sp.toString();

  function apply(params: string) {
    router.push(params ? `${pathname}?${params}` : pathname);
  }

  function remove(view: SavedViewItem) {
    if (!confirm(`Excluir a visão "${view.name}"?`)) return;
    start(async () => {
      const res = await deleteView(view.id);
      if (!res.ok) alert(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground mr-1">Visões:</span>
      {views.length === 0 && (
        <span className="text-xs text-muted-foreground/70">nenhuma salva ainda</span>
      )}
      {views.map((v) => {
        const active = v.params === currentParams;
        return (
          <span key={v.id} className="inline-flex items-center group">
            <button type="button" onClick={() => apply(v.params)} title={v.visibility === "GLOBAL" ? "Visão global (todos veem)" : "Visão privada"}>
              <Badge variant={active ? "default" : "outline"} className="gap-1 pr-1.5">
                {v.visibility === "GLOBAL" ? (
                  <Globe className="h-3 w-3" />
                ) : (
                  <Lock className="h-3 w-3" />
                )}
                {v.name}
                {v.mine && (
                  <X
                    className="h-3 w-3 opacity-0 group-hover:opacity-70 hover:!opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!pending) remove(v);
                    }}
                  />
                )}
              </Badge>
            </button>
          </span>
        );
      })}
      <SaveViewDialog module={module} currentParams={currentParams} />
    </div>
  );
}

function SaveViewDialog({ module, currentParams }: { module: string; currentParams: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
          <BookmarkPlus className="h-3.5 w-3.5 mr-1" /> Salvar visão atual
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Salvar visão</DialogTitle></DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await saveView(fd);
            if (res.ok) { setOpen(false); router.refresh(); } else setError(res.error);
          })}
          className="space-y-3"
        >
          <input type="hidden" name="module" value={module} />
          <input type="hidden" name="params" value={currentParams} />
          <div>
            <Label>Nome *</Label>
            <Input name="name" required placeholder="Ex.: Inadimplentes 60+, Fixas do mês…" />
          </div>
          <div>
            <Label>Visibilidade</Label>
            <Select name="visibility" defaultValue="PRIVATE">
              <option value="PRIVATE">Privada (só eu vejo)</option>
              <option value="GLOBAL">Global (toda a equipe vê)</option>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Salva os filtros aplicados agora nesta tela.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
