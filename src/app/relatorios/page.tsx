import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth/viewer";
import { REPORTS } from "@/lib/reports/registry";
import { Card, CardContent } from "@/components/ui/card";
import { FileBarChart2, ArrowRight } from "lucide-react";

export default async function RelatoriosPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Análises personalizáveis com filtros, agrupamento e exportação — sem alterar os dados originais"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => (
          <Link key={r.key} href={`/relatorios/${r.key}${r.defaultPeriodo ? `?periodo=${r.defaultPeriodo}` : ""}`}>
            <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-soft group">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <FileBarChart2 className="h-5 w-5 text-primary mb-3" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="font-semibold">{r.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{r.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
