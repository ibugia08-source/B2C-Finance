"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { formatBRL, formatDateInputLocal } from "@/lib/format";
import { saveExtraRevenue, deleteExtraRevenue } from "@/lib/actions/extra-revenues";
import {
  EXTRA_REVENUE_MANUAL_TYPES,
  EXTRA_REVENUE_TYPE_LABEL,
} from "@/lib/extra-revenue-meta";

/**
 * RECEITAS EXTRAS DO MÊS — o quadro próprio, no fim da Gestão do Mês.
 *
 * Entradas que NÃO vêm de cobrança a cliente: rendimento de aplicação, venda
 * de equipamento, prêmio, ajuste positivo. O exercício (competência) é
 * informado no ato do cadastro — pode diferir do mês do caixa — e o valor
 * entra no Recebido do mês da competência, no Painel Anual e no DRE
 * (bloco "Receitas extras" do razão).
 */

export type ExtraRevenueRow = {
  id: string;
  description: string;
  typeLabel: string;
  /** "MM/AAAA" do exercício informado no cadastro */
  competenceBR: string;
  receivedBR: string;
  amount: number;
};

/** Data default dentro da competência exibida: hoje (se for o mês) ou dia 1º. */
function defaultDateFor(month: number, year: number): string {
  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() + 1 === month)
    return formatDateInputLocal(now);
  return formatDateInputLocal(new Date(year, month - 1, 1));
}

function NovaReceitaExtraDialog({ month, year }: { month: number; year: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const competence = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Nova receita extra
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova receita extra</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await saveExtraRevenue(fd);
              if (res.ok) {
                setOpen(false);
                router.refresh();
              } else setError(res.error);
            })
          }
          className="grid grid-cols-2 gap-3"
        >
          <div className="col-span-2">
            <Label>Descrição *</Label>
            <Input
              name="description"
              required
              placeholder="ex.: Rendimento da aplicação, venda de equipamento…"
            />
          </div>
          <div>
            <Label>Valor (R$) *</Label>
            <Input name="amount" inputMode="decimal" required placeholder="0,00" />
          </div>
          <div>
            <Label>Competência (exercício) *</Label>
            <Input type="month" name="competence" defaultValue={competence} required />
          </div>
          <div>
            <Label>Recebida em *</Label>
            <Input
              type="date"
              name="receivedAt"
              defaultValue={defaultDateFor(month, year)}
              required
            />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="type" defaultValue="MANUAL_EXTRA_REVENUE">
              {EXTRA_REVENUE_MANUAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EXTRA_REVENUE_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Entrada que não vem de cobrança a cliente. Ela conta no mês da
            competência escolhida — no Recebido, no Painel Anual e no DRE como
            receita extra. Mês fechado não aceita lançamento.
          </p>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Lançar receita"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExcluirButton({ id, description }: { id: string; description: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Excluir receita extra"
      disabled={pending}
      onClick={async () => {
        if (
          !(await confirmAction({
            title: "Excluir receita extra?",
            description: `"${description}" sai do mês, do Painel Anual e do DRE (o lançamento contábil é estornado).`,
            destructive: true,
          }))
        )
          return;
        start(async () => {
          await deleteExtraRevenue(id);
          router.refresh();
        });
      }}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

export function ExtraRevenueSection({
  rows,
  total,
  month,
  year,
  canCreate,
  canDelete,
}: {
  rows: ExtraRevenueRow[];
  total: number;
  month: number;
  year: number;
  canCreate: boolean;
  canDelete: boolean;
}) {
  return (
    <section id="receitas-extras" className="mt-6 scroll-mt-20">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-[-0.01em]">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
            Receitas Extras do Mês
          </h2>
          <p className="text-xs text-muted-foreground">
            Entradas de outras fontes, fora das cobranças a clientes — entram no
            exercício informado no cadastro e no DRE
          </p>
        </div>
        {canCreate && <NovaReceitaExtraDialog month={month} year={year} />}
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nenhuma receita extra neste mês.
              {canCreate
                ? " Rendimentos, vendas pontuais e ajustes entram por aqui."
                : ""}
            </p>
          ) : (
            <Table containerClassName="max-h-[48vh]">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Recebida em</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  {canDelete && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[340px]">
                      <span className="block truncate font-medium">{r.description}</span>
                      <Badge variant="outline" className="mt-0.5 text-[10px]">
                        {r.typeLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{r.competenceBR}</TableCell>
                    <TableCell className="tabular-nums">{r.receivedBR}</TableCell>
                    <TableCell className="text-right stat-number">
                      {formatBRL(r.amount)}
                    </TableCell>
                    {canDelete && (
                      <TableCell className="text-right">
                        <ExcluirButton id={r.id} description={r.description} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={3}>Total de receitas extras do mês</TableCell>
                  <TableCell className="text-right stat-number">
                    {formatBRL(total)}
                  </TableCell>
                  {canDelete && <TableCell />}
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
