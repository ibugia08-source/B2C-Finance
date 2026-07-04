import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CardDialog } from "./card-dialog";
import { CardRowActions } from "./row-actions";
import { InvoiceImportDialog } from "./invoice-import-dialog";
import { QuickRenameCard } from "./quick-rename";
import { Badge } from "@/components/ui/badge";
import {
  limitesUsadosPorCartao,
  parcelasFuturasEstimadasPorCartao,
} from "@/lib/services/calculations";
import { ArrowRight } from "lucide-react";
import { getViewer } from "@/lib/auth/viewer";

export default async function CartoesPage() {
  await getViewer();
  const [cards, people, accounts] = await Promise.all([
    prisma.creditCard.findMany({
      orderBy: { name: "asc" },
      include: { holder: true },
    }),
    prisma.person.findMany({ orderBy: { name: "asc" } }),
    prisma.account.findMany({ orderBy: { name: "asc" } }),
  ]);

  const cardIds = cards.map((c) => c.id);
  const [usedByCard, futureByCard] = await Promise.all([
    limitesUsadosPorCartao(cardIds),
    parcelasFuturasEstimadasPorCartao(cardIds),
  ]);

  const enriched = cards.map((c) => {
    const used = usedByCard.get(c.id) ?? 0;
    return {
      card: c,
      used,
      available: Math.max(0, c.limitTotal - used),
      futureInstallments: futureByCard.get(c.id) ?? 0,
    };
  });

  return (
    <div>
      <PageHeader title="Contas bancárias" actions={<CardDialog people={people} accounts={accounts} />} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {enriched.map(({ card: c, used, available, futureInstallments }) => {
          const pct = c.limitTotal > 0 ? (used / c.limitTotal) * 100 : 0;
          return (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <QuickRenameCard id={c.id} name={c.name} />
                  <Badge variant="secondary" className="capitalize">
                    {c.type}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {c.bank} · Titular: {c.holder?.name ?? "—"} · Fecha dia {c.closingDay} · Vence dia {c.dueDay}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Limite usado</span>
                    <span className="font-medium">
                      {formatBRL(used)} / {formatBRL(c.limitTotal)}
                    </span>
                  </div>
                  <Progress value={pct} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Disponível</p>
                    <p className="font-medium text-emerald-600">{formatBRL(available)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Parcelas futuras (estimativa)</p>
                    <p className="font-medium">{formatBRL(futureInstallments)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-2 items-center justify-between">
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/cartoes/${c.id}`}>
                      <Button size="sm">
                        Ver detalhes <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </Link>
                    <InvoiceImportDialog cardId={c.id} cardName={c.name} />
                  </div>
                  <CardRowActions card={c} people={people} accounts={accounts} />
                </div>
              </CardContent>
            </Card>
          );
        })}
        {enriched.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">Nenhuma conta bancária cadastrada.</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
