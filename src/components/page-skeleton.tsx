import { Card, CardContent } from "@/components/ui/card";

/**
 * Skeleton genérico exibido pelos loading.tsx enquanto as páginas dinâmicas
 * consultam o banco — melhora muito a percepção de velocidade na navegação.
 */
export function PageSkeleton({
  cards = 4,
  rows = 6,
}: {
  cards?: number;
  rows?: number;
}) {
  return (
    <div className="animate-pulse">
      {/* Mesmas medidas do PageHeader real (mb-8 · título ~text-3xl) para o
          conteúdo não "pular" quando o skeleton dá lugar à página. */}
      <div className="mb-8 space-y-2">
        <div className="h-8 sm:h-9 w-64 rounded-md bg-muted" />
        <div className="h-4 w-96 max-w-full rounded-md bg-muted/70" />
      </div>

      {cards > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: cards }).map((_, i) => (
            <Card key={`skeleton-card-${i}`}>
              <CardContent className="p-5 space-y-3">
                <div className="h-3 w-24 rounded bg-muted" />
                <div className="h-7 w-32 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={`skeleton-row-${i}`} className="h-9 w-full rounded bg-muted/60" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
