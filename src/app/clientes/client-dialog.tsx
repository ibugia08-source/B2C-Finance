"use client";
import { useEffect, useState, useTransition } from "react";
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
import { saveClient, getClientForEdit } from "@/lib/actions/clients";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL } from "./_meta";

/** Parse tolerante de dinheiro pt-BR ("1.500,00" → 1500) só para validar > 0. */
function looseMoney(s: string): number {
  const cleaned = String(s).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

// Validação client-side (espelha a Server Action; strings do formulário).
// Regras condicionais por modalidade (Bloco 1 §7).
const FormSchema = z
  .object({
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
    status: z.string(),
    // Modalidade — decide quais campos são exigidos.
    paymentModel: z.string(), // "" | "MRR" | "TCV"
    monthlyValue: z.string(), // MRR
    totalContractValue: z.string(), // TCV
    paymentDay: z
      .string()
      .refine(
        (v) => v === "" || (parseInt(v, 10) >= 1 && parseInt(v, 10) <= 31),
        "Dia entre 1 e 31."
      ),
    contractMonths: z.string(),
    startedAt: z.string(),
    tags: z.string(),
    notes: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.paymentModel === "MRR") {
      if (looseMoney(v.monthlyValue) <= 0)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["monthlyValue"],
          message: "Informe o valor mensal recorrente (maior que zero).",
        });
      if (v.paymentDay === "")
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentDay"],
          message: "Informe o dia recorrente de pagamento.",
        });
    }
    if (v.paymentModel === "TCV") {
      if (looseMoney(v.totalContractValue) <= 0)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totalContractValue"],
          message: "Informe o valor total do contrato (maior que zero).",
        });
      if (v.contractMonths === "")
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contractMonths"],
          message: "Informe o prazo do contrato (meses).",
        });
      if (v.startedAt === "")
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startedAt"],
          message: "Informe a data de entrada/fechamento.",
        });
    }
  });
type FormValues = z.infer<typeof FormSchema>;
const FORM_KEYS = Object.keys(FormSchema.innerType().shape) as (keyof FormValues)[];

/** Formata dinheiro para o input: number → "1500,00"; string (form/IA) intacta. */
function moneyStr(v: any): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") return v.toFixed(2).replace(".", ",");
  return String(v);
}

function toFormValues(src: any): FormValues {
  return {
    name: src?.name ?? "",
    legalName: src?.legalName ?? "",
    document: src?.document ?? "",
    email: src?.email ?? "",
    phone: src?.phone ?? "",
    segment: src?.segment ?? "",
    city: src?.city ?? "",
    state: src?.state ?? "",
    address: src?.address ?? "",
    legalRepresentative: src?.legalRepresentative ?? "",
    origin: src?.origin ?? "",
    salesOwner: src?.salesOwner ?? "",
    opsOwner: src?.opsOwner ?? "",
    status: src?.status ?? "ACTIVE",
    // Aceita `modality` (cadastro/edição) ou `paymentModel` (pré-fill da IA).
    paymentModel: src?.modality ?? src?.paymentModel ?? "",
    monthlyValue: moneyStr(src?.monthlyValue),
    // Aceita `totalContractValue` (cadastro) ou `contractTotal` (pré-fill da IA).
    totalContractValue: moneyStr(src?.totalContractValue ?? src?.contractTotal),
    paymentDay: src?.paymentDay != null ? String(src.paymentDay) : "",
    contractMonths: src?.contractMonths != null ? String(src.contractMonths) : "",
    startedAt: src?.startedAt ? formatDateInput(src.startedAt) : "",
    tags: Array.isArray(src?.tags) ? src.tags.join(", ") : "",
    notes: src?.notes ?? "",
  };
}

export function ClientDialog({
  initial,
  trigger,
}: {
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [pending, start] = useTransition();
  const isNew = !initial?.id;
  // Em edição, a lista passa uma projeção enxuta — carregamos o registro
  // COMPLETO ao abrir para não sobrescrever campos com vazio ao salvar.
  const [data, setData] = useState<any>(initial);
  const [loaded, setLoaded] = useState<boolean>(isNew);

  // Valores default dos inputs (não-controlados). O `key` no <form> força
  // remount quando o registro completo chega, repopulando os campos.
  const dv = toFormValues(data);
  const [paymentModel, setPaymentModel] = useState<string>(dv.paymentModel);

  useEffect(() => {
    if (!open || isNew || loaded) return;
    let active = true;
    (async () => {
      const full = await getClientForEdit(initial.id);
      if (active && full) {
        setData(full);
        setPaymentModel(toFormValues(full).paymentModel);
        setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, isNew, loaded, initial?.id]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(
      FORM_KEYS.map((k) => [k, String(fd.get(k) ?? "")])
    );
    const parsed = FormSchema.safeParse(raw);
    if (!parsed.success) {
      const next: Partial<Record<keyof FormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FormValues;
        if (field && !next[field]) next[field] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    start(async () => {
      setServerError(null);
      const out = new FormData();
      if (initial?.id) out.set("id", initial.id);
      for (const [k, v] of Object.entries(parsed.data)) out.set(k, v);
      const res = await saveClient(out);
      if (res.ok) {
        setOpen(false);
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
        if (!o) {
          setServerError(null);
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Cadastrar novo cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar cliente" : "Cadastrar novo cliente"}</DialogTitle>
        </DialogHeader>
        <form
          key={loaded ? "full" : "lite"}
          onSubmit={onSubmit}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {/* ===== Campos principais — o essencial para operar ===== */}
          <div className="col-span-full">
            <Label>Nome do cliente *</Label>
            <Input name="name" defaultValue={dv.name} placeholder="ex.: Clínica Sorriso" />
            {errors.name && <FieldError msg={errors.name} />}
          </div>

          <div>
            <Label>WhatsApp / Telefone</Label>
            <Input name="phone" defaultValue={dv.phone} placeholder="(71) 9 9999-9999" />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input type="email" name="email" defaultValue={dv.email} placeholder="contato@cliente.com" />
            {errors.email && <FieldError msg={errors.email} />}
          </div>

          <div>
            <Label>Status</Label>
            <Select name="status" defaultValue={dv.status}>
              {CLIENT_STATUSES.filter((s) => s !== "LEAD").map((s) => (
                <option key={s} value={s}>
                  {CLIENT_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Responsável</Label>
            <Input name="salesOwner" defaultValue={dv.salesOwner} placeholder="quem cuida deste cliente" />
          </div>

          {/* ===== Modalidade & cobrança — campos dinâmicos por MRR/TCV ===== */}
          <div className="col-span-full rounded-lg border bg-muted/30 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <p className="col-span-full text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Modalidade e cobrança
            </p>
            <div>
              <Label>Modalidade</Label>
              <Select
                name="paymentModel"
                value={paymentModel}
                onChange={(e) => setPaymentModel(e.target.value)}
              >
                <option value="">— definir depois —</option>
                <option value="MRR">MRR — mensalidade recorrente</option>
                <option value="TCV">TCV — valor fechado (pago no ato)</option>
              </Select>
            </div>
            <div>
              <Label>
                {paymentModel === "TCV" ? "Entrada / fechamento *" : "Entrada"}
              </Label>
              <Input type="date" name="startedAt" defaultValue={dv.startedAt} />
              {errors.startedAt && <FieldError msg={errors.startedAt} />}
            </div>

            {paymentModel === "MRR" && (
              <>
                <div>
                  <Label>Valor mensal recorrente (R$) *</Label>
                  <Input
                    name="monthlyValue"
                    defaultValue={dv.monthlyValue}
                    inputMode="decimal"
                    placeholder="ex.: 1.500,00"
                  />
                  {errors.monthlyValue && <FieldError msg={errors.monthlyValue} />}
                </div>
                <div>
                  <Label>Dia recorrente de pagamento *</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    name="paymentDay"
                    defaultValue={dv.paymentDay}
                    placeholder="ex.: 10"
                  />
                  {errors.paymentDay && <FieldError msg={errors.paymentDay} />}
                </div>
                <div>
                  <Label>Prazo do contrato (meses)</Label>
                  <Input
                    type="number"
                    min={1}
                    name="contractMonths"
                    defaultValue={dv.contractMonths}
                    placeholder="ex.: 12"
                  />
                </div>
                <p className="col-span-full text-xs text-muted-foreground">
                  MRR é uma mensalidade recorrente. Este cliente entra todos os
                  meses na lista de recebimentos enquanto estiver ativo.
                </p>
              </>
            )}

            {paymentModel === "TCV" && (
              <>
                <div>
                  <Label>Valor total do contrato (R$) *</Label>
                  <Input
                    name="totalContractValue"
                    defaultValue={dv.totalContractValue}
                    inputMode="decimal"
                    placeholder="ex.: 3.000,00"
                  />
                  {errors.totalContractValue && (
                    <FieldError msg={errors.totalContractValue} />
                  )}
                </div>
                <div>
                  <Label>Prazo do contrato (meses) *</Label>
                  <Input
                    type="number"
                    min={1}
                    name="contractMonths"
                    defaultValue={dv.contractMonths}
                    placeholder="ex.: 3"
                  />
                  {errors.contractMonths && <FieldError msg={errors.contractMonths} />}
                </div>
                <p className="col-span-full text-xs text-muted-foreground">
                  TCV é um pagamento único do contrato. O valor entra
                  integralmente no mês de fechamento e não é dividido nos meses
                  seguintes. Na renovação, o cliente paga o valor cheio de novo.
                </p>
              </>
            )}
          </div>

          {/* ===== Avançado — dados fiscais, contratuais e internos ===== */}
          <details className="col-span-full rounded-lg border">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Avançado — dados fiscais, endereço e detalhes internos (opcional)
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 pt-1">
              <div>
                <Label>Razão social</Label>
                <Input name="legalName" defaultValue={dv.legalName} />
              </div>
              <div>
                <Label>CNPJ / CPF</Label>
                <Input name="document" defaultValue={dv.document} placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <Label>Segmento / nicho</Label>
                <Input name="segment" defaultValue={dv.segment} placeholder="ex.: odontologia" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label>Cidade</Label>
                  <Input name="city" defaultValue={dv.city} />
                </div>
                <div>
                  <Label>UF</Label>
                  <Input name="state" defaultValue={dv.state} maxLength={2} placeholder="BA" />
                  {errors.state && <FieldError msg={errors.state} />}
                </div>
              </div>
              <div>
                <Label>Endereço (usado nos contratos)</Label>
                <Input name="address" defaultValue={dv.address} placeholder="rua, nº, bairro, cidade/UF" />
              </div>
              <div>
                <Label>Representante legal</Label>
                <Input name="legalRepresentative" defaultValue={dv.legalRepresentative} placeholder="quem assina o contrato" />
              </div>
              <div>
                <Label>Origem</Label>
                <Input name="origin" defaultValue={dv.origin} placeholder="indicação, tráfego, orgânico…" />
              </div>
              <div>
                <Label>Responsável operacional</Label>
                <Input name="opsOwner" defaultValue={dv.opsOwner} />
              </div>
              <div className="col-span-full">
                <Label>Tags</Label>
                <Input name="tags" defaultValue={dv.tags} placeholder="vip, mensal, tráfego" />
                <p className="text-xs text-muted-foreground mt-1">Separe por vírgula.</p>
              </div>
              <div className="col-span-full">
                <Label>Observações</Label>
                <Textarea name="notes" defaultValue={dv.notes} />
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
            <Button type="submit" disabled={pending || !loaded}>
              {pending ? "Salvando…" : !loaded ? "Carregando…" : "Salvar"}
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
