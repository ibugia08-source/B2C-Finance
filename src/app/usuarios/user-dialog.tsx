"use client";
import { useState } from "react";
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
import { createUser, updateUser } from "@/lib/actions/users";
import { Plus } from "lucide-react";

export function UserDialog({
  people,
  initial,
  trigger,
}: {
  people: any[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const editing = !!initial?.id;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Novo usuário
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar usuário" : "Novo usuário"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            if (editing) await updateUser(fd);
            else await createUser(fd);
            setOpen(false);
          }}
          className="space-y-3"
        >
          {editing && <input type="hidden" name="id" value={initial.id} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nome</Label>
              <Input name="name" defaultValue={initial?.name ?? ""} required />
            </div>
            <div className="col-span-2">
              <Label>E-mail</Label>
              <Input
                name="email"
                type="email"
                defaultValue={initial?.email ?? ""}
                required
              />
            </div>
            <div className="col-span-2">
              <Label>{editing ? "Nova senha (opcional)" : "Senha inicial"}</Label>
              <Input
                name="password"
                type="text"
                placeholder={editing ? "Deixe em branco para manter" : "mínimo 6 caracteres"}
                required={!editing}
                minLength={editing ? undefined : 6}
              />
            </div>
            <div>
              <Label>Papel</Label>
              <Select name="role" defaultValue={initial?.role ?? "USER"}>
                <option value="USER">Usuário</option>
                <option value="ADMIN">Administrador</option>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select name="active" defaultValue={String(initial?.active ?? true)}>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Pessoa vinculada (opcional)</Label>
              <Select
                name="personId"
                defaultValue={initial?.personId ?? ""}
              >
                <option value="">— sem vínculo</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.userId && p.userId !== initial?.id ? " (já vinculada)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
