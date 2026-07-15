import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "../../../shared-components";

export default async function HistoricoPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Empty>
          Histórico de operações (CollectionHistory + churn) do cliente {params.id} —
          será migrado da aba &quot;Histórico&quot; em breve.
        </Empty>
      </CardContent>
    </Card>
  );
}
