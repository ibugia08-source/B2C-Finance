import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { ImportForm } from "./import-form";
import { InvoicesHistory } from "./invoices-history";
import { DeleteBatchButton } from "./delete-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getViewer } from "@/lib/auth/viewer";

export default async function ImportarPage() {
  await getViewer();
  const [cards, accounts, batches, invoices] = await Promise.all([
    prisma.creditCard.findMany({ orderBy: { name: "asc" } }),
    prisma.account.findMany({ orderBy: { name: "asc" } }),
    prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.creditCardInvoice.findMany({
      orderBy: [{ referenceYear: "desc" }, { referenceMonth: "desc" }],
      include: { card: { select: { id: true, name: true, bank: true } } },
      take: 36,
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Importar fatura"
        description="Suba a fatura do cartão em PDF — o banco e o cartão são detectados automaticamente e as compras são lançadas na fatura do mês. Também aceita CSV/XLSX."
      />

      <Tabs defaultValue="importar">
        <TabsList>
          <TabsTrigger value="importar">Importar fatura</TabsTrigger>
          <TabsTrigger value="faturas">Histórico de faturas</TabsTrigger>
        </TabsList>

        <TabsContent value="importar" className="pt-4 space-y-6">
          <Card>
            <CardContent className="p-6">
              <ImportForm cards={cards} accounts={accounts} />
            </CardContent>
          </Card>

          <div>
            <h2 className="text-lg font-semibold mb-2">Histórico de importações</h2>
            <Card>
              <CardContent className="p-4">
                {batches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma importação ainda.</p>
                ) : (
                  <ul className="text-sm space-y-2">
                    {batches.map((b) => (
                      <li
                        key={b.id}
                        className="flex items-center justify-between gap-2 border-b py-2 last:border-0"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{b.fileName ?? b.source}</span>{" "}
                          <span className="text-muted-foreground">
                            ({new Date(b.createdAt).toLocaleString("pt-BR")})
                          </span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                          {b.imported}/{b.total} importadas · {b.duplicates} duplicatas
                          <DeleteBatchButton
                            batchId={b.id}
                            label={b.fileName ?? b.source}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="faturas" className="pt-4">
          <Card>
            <CardContent className="p-0">
              <InvoicesHistory invoices={invoices} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
