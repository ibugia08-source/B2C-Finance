import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CashBoxDialog } from "./cashbox-dialog";
import { CashBoxActions, MovementDeleteButton } from "./row-actions";
import { MovementDialog } from "./movement-dialog";
import { getViewer } from "@/lib/auth/viewer";

const TYPE_LABEL: Record<string, string> = {
  PERSONAL: "Caixa pessoal",
  EMERGENCY: "Reserva de emergência",
  INVESTMENT: "Investimento",
  COMPANY: "Empresa",
  GOAL: "Objetivo específico",
  OTHER: "Outro",
};

export default async function CaixaPage() {
  await getViewer();
  const [boxes, accounts] = await Promise.all([
    prisma.cashBox.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        account: true,
        movements: { orderBy: { date: "desc" }, take: 10 },
      },
    }),
    prisma.account.findMany({ orderBy: { name: "asc" } }),
  ]);

  const totalCaixa = boxes.reduce((s, b) => s + b.currentAmount, 0);
  const totalReserva = boxes
    .filter((b) => b.type === "EMERGENCY")
    .reduce((s, b) => s + b.currentAmount, 0);

  return (
    <div>
      <PageHeader
        title="Caixa"
        description="Gerencie o dinheiro que você guarda e separa"
        actions={<CashBoxDialog accounts={accounts} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard title="Total em caixa" value={formatBRL(totalCaixa)} intent="positive" />
        <StatCard title="Reserva de emergência" value={formatBRL(totalReserva)} />
        <StatCard title="Quantidade de caixas" value={String(boxes.length)} />
      </div>

      {boxes.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum caixa cadastrado. Crie seu primeiro caixa para começar a guardar dinheiro.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {boxes.map((box) => {
          const pct =
            box.targetAmount && box.targetAmount > 0
              ? Math.min(100, (box.currentAmount / box.targetAmount) * 100)
              : null;
          return (
            <Card key={box.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div>
                  <CardTitle>{box.name}</CardTitle>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <Badge variant="secondary">{TYPE_LABEL[box.type] ?? box.type}</Badge>
                    {box.account && <Badge variant="outline">{box.account.name}</Badge>}
                  </div>
                </div>
                <CashBoxActions box={box} accounts={accounts} />
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-2xl font-bold text-emerald-600">
                    {formatBRL(box.currentAmount)}
                  </p>
                  {box.targetAmount && (
                    <p className="text-xs text-muted-foreground">
                      Meta: {formatBRL(box.targetAmount)}
                    </p>
                  )}
                </div>
                {pct !== null && <Progress value={pct} />}

                <div className="flex gap-2">
                  <MovementDialog cashBoxId={box.id} type="IN" />
                  <MovementDialog cashBoxId={box.id} type="OUT" />
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Últimas movimentações
                  </p>
                  {box.movements.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem movimentações ainda.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {box.movements.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <Badge
                              variant={m.type === "IN" ? "success" : "destructive"}
                              className="shrink-0 text-[10px]"
                            >
                              {m.type === "IN" ? "Entrada" : "Saída"}
                            </Badge>
                            <span className="shrink-0 text-muted-foreground">
                              {formatDateBR(m.date)}
                            </span>
                            {m.description && (
                              <span className="truncate">— {m.description}</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span
                              className={
                                m.type === "IN" ? "text-emerald-600" : "text-red-600"
                              }
                            >
                              {m.type === "IN" ? "+" : "-"}
                              {formatBRL(m.amount)}
                            </span>
                            <MovementDeleteButton id={m.id} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {box.notes && (
                  <p className="text-xs text-muted-foreground border-t pt-2">{box.notes}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
