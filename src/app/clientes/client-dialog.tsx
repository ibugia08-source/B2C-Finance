"use client";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Textarea } from "@/components/ui/textarea";
import { saveClient } from "@/lib/actions/clients";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL } from "./_meta";

// Validação client-side (espelha a Server Action; strings do formulário).
const FormSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do cliente."),
  legalName: z.string(),
  document: z.string(),
  email: z
    .union([z.string().trim().email("E-mail inválido."), z.literal("")])
    .default(""),
  phone: z.string(),
  segment: z.string(),
  city: z.string(),
  state: z.string().trim().max(2, "Use a sigla da UF (ex.: BA)"),
  address: z.string(),
  legalRepresentative: z.string(),
  origin: z.string(),
  salesOwner: z.string(),
  opsOwner: z.string(),
  paymentDay: z
    .string()
    .refine(
      (v) => v === "" || (parseInt(v, 10) >= 1 && parseInt(v, 10) <= 28),
      "Dia entre 1 e 28."
    ),
  status: z.string(),
  monthlyValue: z.string(),
  startedAt: z.string(),
  paymentModel: z.string(),
  contractTotal: z.string(),
  contractMonths: z.string(),
  saleDate: z.string(),
  tags: z.string(),
  notes: z.string(),
});
type FormValues = z.infer<typeof FormSchema>;

export function ClientDialog({
  initial,
  trigger,
}: {
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    values: {
      name: initial?.name ?? "",
      legalName: initial?.legalName ?? "",
      document: initial?.document ?? "",
      email: initial?.email ?? "",
      phone: initial?.phone ?? "",
      segment: initial?.segment ?? "",
      city: initial?.city ?? "",
      state: initial?.state ?? "",
      address: initial?.address ?? "",
      legalRepresentative: initial?.legalRepresentative ?? "",
      origin: initial?.origin ?? "",
      salesOwner: initial?.salesOwner ?? "",
      opsOwner: initial?.opsOwner ?? "",
      paymentDay: initial?.paymentDay != null ? String(initial.paymentDay) : "",
      status: initial?.status ?? "ACTIVE",
      monthlyValue:
        initial?.monthlyValue != null
          ? Number(initial.monthlyValue).toFixed(2).replace(".", ",")
          : "",
      startedAt: initial?.startedAt ? formatDateInput(initial.startedAt) : "",
      paymentModel: initial?.paymentModel ?? "",
      contractTotal: initial?.contractTotal ?? "",
      contractMonths: initial?.contractMonths ?? "",
      saleDate: "",
      tags: Array.isArray(initial?.tags) ? initial.tags.join(", ") : "",
      notes: initial?.notes ?? "",
    },
  });
  const { register, handleSubmit, formState, watch } = form;
  const err = formState.errors;
  const paymentModel = watch("paymentModel");
  const isNew = !initial?.id;

  function onSubmit(values: FormValues) {
    start(async () => {
      setServerError(null);
      const fd = new FormData();
      if (initial?.id) fd.set("id", initial.id);
      for (const [k, v] of Object.entries(values)) fd.set(k, v);
      const res = await saveClient(fd);
      if (res.ok) {
        setOpen(false);
        form.reset();
      } else {
        setServerError(res.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setServerError(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Novo cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {/* ===== Campos principais — o essencial para operar ===== */}
          <div className="col-span-full">
            <Label>Nome do cliente *</Label>
            <Input {...register("name")} placeholder="ex.: Clínica Sorriso" />
            {err.name && <FieldError msg={err.name.message} />}
          </div>

          <div>
            <Label>WhatsApp / Telefone</Label>
            <Input {...register("phone")} placeholder="(71) 9 9999-9999" />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input type="email" {...register("email")} placeholder="contato@cliente.com" />
            {err.email && <FieldError msg={err.email.message} />}
          </div>

          <div>
            <Label>Status</Label>
            <Select {...register("status")}>
              {CLIENT_STATUSES.filter((s) => s !== "LEAD").map((s) => (
                <option key={s} value={s}>
                  {CLIENT_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Responsável</Label>
            <Input {...register("salesOwner")} placeholder="quem cuida deste cliente" />
          </div>

          {!isNew && (
            <div>
              <Label>Valor mensal (R$)</Label>
              <Input {...register("monthlyValue")} inputMode="decimal" placeholder="0,00" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Dia de pagamento</Label>
              <Input
                type="number"
                min={1}
                max={28}
                {...register("paymentDay")}
                placeholder="5"
              />
              {err.paymentDay && <FieldError msg={err.paymentDay.message} />}
            </div>
            <div>
              <Label>Entrada</Label>
              <Input type="date" {...register("startedAt")} />
            </div>
          </div>

          {isNew && (
            <div className="col-span-full rounded-lg border bg-muted/30 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <p className="col-span-full text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Fechamento do contrato (venda)
              </p>
              <div>
                <Label>Tipo da venda</Label>
                <Select {...register("paymentModel")}>
                  <option value="">— sem contrato agora —</option>
                  <option value="MRR">MRR (recorrente mensal)</option>
                  <option value="TCV">TCV (valor fechado)</option>
                </Select>
              </div>
              {paymentModel && (
                <div>
                  <Label>Data do fechamento (venda) *</Label>
                  <Input type="date" {...register("saleDate")} required />
                </div>
              )}
              {paymentModel && (
                <div>
                  <Label>Valor total do contrato (R$) *</Label>
                  <Input {...register("contractTotal")} inputMode="decimal" placeholder="ex.: 5100,00" required />
                </div>
              )}
              {paymentModel && (
                <div>
                  <Label>Prazo do contrato (meses) *</Label>
                  <Input type="number" min={1} {...register("contractMonths")} placeholder="ex.: 3" required />
                </div>
              )}
              {paymentModel === "MRR" && (
                <p className="sm:col-span-2 text-xs text-muted-foreground">
                  O sistema calcula o mensal (total ÷ prazo) e cria as cobranças
                  recorrentes a partir do mês da venda até o fim do prazo.
                </p>
              )}
              {paymentModel === "TCV" && (
                <p className="sm:col-span-2 text-xs text-muted-foreground">
                  O valor CHEIO entra uma única vez no mês da venda — não é
                  distribuído pelos meses contratados. Na renovação, o cliente
                  paga o valor cheio novamente.
                </p>
              )}
            </div>
          )}
          {/* ===== Avançado — dados fiscais, contratuais e internos ===== */}
          <details className="col-span-full rounded-lg border">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Avançado — dados fiscais, endereço e detalhes internos (opcional)
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 pt-1">
              <div>
                <Label>Razão social</Label>
                <Input {...register("legalName")} />
              </div>
              <div>
                <Label>CNPJ / CPF</Label>
                <Input {...register("document")} placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <Label>Segmento / nicho</Label>
                <Input {...register("segment")} placeholder="ex.: odontologia" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label>Cidade</Label>
                  <Input {...register("city")} />
                </div>
                <div>
                  <Label>UF</Label>
                  <Input {...register("state")} maxLength={2} placeholder="BA" />
                  {err.state && <FieldError msg={err.state.message} />}
                </div>
              </div>
              <div>
                <Label>Endereço (usado nos contratos)</Label>
                <Input {...register("address")} placeholder="rua, nº, bairro, cidade/UF" />
              </div>
              <div>
                <Label>Representante legal</Label>
                <Input {...register("legalRepresentative")} placeholder="quem assina o contrato" />
              </div>
              <div>
                <Label>Origem</Label>
                <Input {...register("origin")} placeholder="indicação, tráfego, orgânico…" />
              </div>
              <div>
                <Label>Responsável operacional</Label>
                <Input {...register("opsOwner")} />
              </div>
              <div className="col-span-full">
                <Label>Tags</Label>
                <Input {...register("tags")} placeholder="vip, mensal, tráfego" />
                <p className="text-xs text-muted-foreground mt-1">Separe por vírgula.</p>
              </div>
              <div className="col-span-full">
                <Label>Observações</Label>
                <Textarea {...register("notes")} />
              </div>
            </div>
          </details>

          {serverError && (
            <p className="col-span-full text-sm text-destructive">{serverError}</p>
          )}

          <DialogFooter className="col-span-full">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return <p className="text-xs text-destructive mt-1">{msg}</p>;
}
