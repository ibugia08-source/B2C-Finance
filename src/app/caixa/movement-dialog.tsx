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
import { registerCashMovement } from "@/lib/actions/cashboxes";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { formatDateInput } from "@/lib/format";

export function MovementDialog({
  cashBoxId,
  type,
}: {
  cashBoxId: string;
  type: "IN" | "OUT";
}) {
  const [open, setOpen] = useState(false);
  const isIn = type === "IN";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={isIn ? "default" : "outline"} size="sm">
          {isIn ? (
            <ArrowUpCircle className="h-4 w-4 mr-1" />
          ) : (
            <ArrowDownCircle className="h-4 w-4 mr-1" />
          )}
          {isIn ? "Entrada" : "Retirada"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isIn ? "Registrar entrada" : "Registrar retirada"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await registerCashMovement(fd);
            setOpen(false);
          }}
          className="space-y-3"
        >
          <input type="hidden" name="cashBoxId" value={cashBoxId} />
          <input type="hidden" name="type" value={type} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Valor</Label>
              <Input name="amount" defaultValue="0,00" required />
            </div>
            <div>
              <Label>Data</Label>
              <Input
                type="date"
                name="date"
                defaultValue={formatDateInput(new Date())}
                required
              />
            </div>
          </div>
          <div>
            <Label>Descrição</Label>
            <Input name="description" placeholder="Opcional" />
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
