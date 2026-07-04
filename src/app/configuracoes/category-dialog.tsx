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
import { saveCategory } from "@/lib/actions/categories";
import { Plus } from "lucide-react";

export function CategoryDialog({ initial, trigger }: { initial?: any; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova categoria
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar categoria" : "Nova categoria"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await saveCategory(fd);
            setOpen(false);
          }}
          className="space-y-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          <div>
            <Label>Nome</Label>
            <Input name="name" defaultValue={initial?.name ?? ""} required />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="kind" defaultValue={initial?.kind ?? "despesa"}>
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
              <option value="mista">Mista</option>
            </Select>
          </div>
          <div>
            <Label>Cor</Label>
            <Input name="color" type="color" defaultValue={initial?.color ?? "#3b82f6"} />
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
