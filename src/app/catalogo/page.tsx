import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import {
  MobileCard, MobileCardHeader, Field,
} from "@/components/ui/record-card";
import { Inbox } from "lucide-react";
import { requireAdmin } from "@/lib/auth/viewer";
import { CATALOGO } from "@/lib/catalogo";

/**
 * CATÁLOGO DE COMPONENTES (T6 · ref. 02 §245).
 *
 * Documentação VIVA: os cinco estados de cada componente canônico, com
 * amostras renderizadas de verdade onde dá — se um componente quebrar, esta
 * tela quebra junto, que é o ponto. O teste tests/catalogo.test.ts é a trava
 * do CI: componente canônico fora da lista ou com estados faltando reprova.
 */
export const dynamic = "force-dynamic";

export default async function CatalogoPage() {
  await requireAdmin();

  return (
    <div>
      <PageHeader
        title="Catálogo de componentes"
        description="Os componentes canônicos do design system, cada um com os 5 estados documentados"
      />

      {/* Amostras vivas dos blocos que rendem sem interação */}
      <h2 className="mb-2 font-display text-lg font-semibold tracking-[-0.01em]">Amostras vivas</h2>
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <StatCard title="KPI único" value="R$ 12.345,67" hint="base: competência (amostra)" />
        <Card>
          <CardContent className="p-3">
            <MobileCard>
              <MobileCardHeader title="MobileCard" aside={<Badge variant="success">Pago</Badge>} />
              <Field label="Campo">Valor de amostra</Field>
            </MobileCard>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <Badge variant="success">Pago</Badge>
            <Badge variant="warning">A vencer</Badge>
            <Badge variant="destructive">Vencido</Badge>
            <Badge variant="secondary">Novo</Badge>
            <Badge variant="outline">Cancelado</Badge>
            <Button size="sm" variant="outline" disabled>
              Desabilitado
            </Button>
          </CardContent>
        </Card>
      </div>
      <div className="mb-6">
        <EmptyState
          icon={Inbox}
          title="EmptyState de amostra"
          description="É assim que uma tela vazia ensina o próximo passo."
        />
      </div>

      {/* Os 5 estados de cada componente */}
      <div className="space-y-4">
        {CATALOGO.map((c) => (
          <Card key={c.componente}>
            <CardContent className="p-4">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-emphasis font-semibold">{c.componente}</h3>
                <code className="text-caption text-muted-foreground">{c.arquivo}</code>
              </div>
              <p className="mb-3 text-dense text-muted-foreground">{c.papel}</p>
              <dl className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {c.estados.map((e) => (
                  <div key={e.nome} className="rounded-md border border-border-soft p-2.5">
                    <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                      {e.nome}
                    </dt>
                    <dd className="mt-0.5 text-dense">{e.descricao}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
