"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  saveClientDocument,
  deleteClientDocument,
  saveClientNote,
  deleteClientNote,
} from "@/lib/actions/contract-templates";
import { DOCUMENT_TYPE_LABEL, NOTE_TYPE_LABEL } from "@/app/contratos/_meta";
import { Paperclip, Trash2, MessageSquarePlus, Pencil } from "lucide-react";

/** Anexar documento ao cliente (PDF, Word, imagem, planilha…). */
export function AttachDocumentDialog({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Paperclip className="h-3.5 w-3.5 mr-1" /> Anexar documento
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anexar documento ao cliente</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await saveClientDocument(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="space-y-3"
        >
          <input type="hidden" name="clientId" value={clientId} />
          <div>
            <Label>Arquivo *</Label>
            <input
              name="file"
              type="file"
              required
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.txt"
              className="block w-full text-sm mt-1 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-primary-foreground file:text-sm hover:file:brightness-110 border border-input rounded-md"
            />
          </div>
          <div>
            <Label>Nome do documento</Label>
            <Input name="name" placeholder="ex.: Contrato assinado 2026" />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="documentType" defaultValue="OTHER">
              {Object.entries(DOCUMENT_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Descrição</Label>
            <Input name="description" placeholder="opcional" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Anexar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentDeleteButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Excluir documento" className="text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Excluir documento?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">“{name}” será removido do histórico do cliente.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => start(async () => {
              const res = await deleteClientDocument(id);
              if (res.ok) setOpen(false); else setError(res.error);
            })}
          >
            {pending ? "Excluindo…" : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Note = { id: string; title: string; content: string; type: string | null };

/** Criar/editar observação de contexto do cliente. */
export function NoteDialog({
  clientId,
  note,
  trigger,
}: {
  clientId: string;
  note?: Note;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <MessageSquarePlus className="h-3.5 w-3.5 mr-1" /> Adicionar observação
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{note ? "Editar observação" : "Nova observação"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await saveClientNote(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="space-y-3"
        >
          <input type="hidden" name="clientId" value={clientId} />
          {note && <input type="hidden" name="id" value={note.id} />}
          <div>
            <Label>Título *</Label>
            <Input name="title" required defaultValue={note?.title} placeholder="ex.: Particularidades do contrato" />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="type" defaultValue={note?.type ?? "observacao"}>
              {Object.entries(NOTE_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Conteúdo *</Label>
            <Textarea
              name="content"
              required
              rows={5}
              defaultValue={note?.content}
              placeholder="contexto comercial, negociação, alertas internos…"
            />
          </div>
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

export function NoteActions({ clientId, note }: { clientId: string; note: Note }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-0.5">
      <NoteDialog
        clientId={clientId}
        note={note}
        trigger={
          <Button size="icon" variant="ghost" title="Editar observação">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        size="icon"
        variant="ghost"
        title="Excluir observação"
        className="text-destructive"
        disabled={pending}
        onClick={() => start(async () => { await deleteClientNote(note.id); })}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
