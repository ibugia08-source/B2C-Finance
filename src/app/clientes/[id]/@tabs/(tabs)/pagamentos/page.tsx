import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "../../../shared-components";

export default async function PagamentosPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Empty>
          Histórico de pagamentos do cliente {params.id} — será migrado da aba
          &quot;Pagamentos&quot; em breve.
        </Empty>
      </CardContent>
    </Card>
  );
}
